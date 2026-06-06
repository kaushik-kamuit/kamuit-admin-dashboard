"""Vehicle onboarding review — document inspection, plate/VIN data, accept/reject/resubmit."""
from __future__ import annotations

import json
from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from app.auth import TokenPayload, require_role
from app.audit import log_action
from app.db import um

router = APIRouter()


def _row(r) -> dict:
    out = {}
    for k, v in dict(r).items():
        if isinstance(v, UUID):
            out[k] = str(v)
        elif isinstance(v, datetime):
            out[k] = v.isoformat()
        elif isinstance(v, bytes):
            out[k] = v.decode()
        else:
            out[k] = v
    return out


@router.get("/queue")
async def review_queue(
    status_filter: str = Query("pending", pattern="^(pending|rejected|all)$"),
    _user: TokenPayload = Depends(require_role("operator")),
):
    """Vehicles needing manual review, enriched with driver + user info."""
    status_clause = ""
    if status_filter == "pending":
        status_clause = "AND lower(v.verification_status::text) = 'pending'"
    elif status_filter == "rejected":
        status_clause = "AND lower(v.verification_status::text) = 'rejected'"

    rows = await um().fetch(f"""
        SELECT
            v.id::text AS vehicle_id,
            v.driver_id::text,
            u.id::text AS user_id,
            u.full_name,
            u.email,
            u.phone_number,
            dp.license_url,
            dp.license_number,
            dp.license_state,
            dp.license_expiry_date,
            lower(dp.verification_status::text) AS driver_status,
            dp.provisional_granted,
            dp.provisional_status,
            dp.provisional_expires_at,
            -- Vehicle identity
            v.vin,
            v.plate_number,
            v.plate_state,
            v.year,
            v.make,
            v.model,
            v.trim,
            v.color,
            v.body_style,
            v.engine,
            v.transmission,
            v.drive_type,
            -- Verification flags
            lower(v.verification_status::text) AS vehicle_status,
            v.vin_verified,
            v.doc_verified,
            v.insurance_verified,
            v.history_verified,
            v.vin_valid,
            v.checksum_ok,
            -- Dates
            v.registration_expiry_date,
            v.registered_owner_name,
            v.owner_permission_granted,
            v.created_at AS vehicle_created_at,
            v.updated_at AS vehicle_updated_at,
            -- Documents & lookup data (returned as raw JSON/text)
            v.registration_doc_url,
            v.registration_doc_json,
            v.plate_lookup_json,
            v.vin_lookup_json,
            v.insurance_summary,
            v.ocr_raw_json,
            v.specs_json
        FROM vehicles v
        JOIN driver_profiles dp ON dp.id = v.driver_id
        JOIN users u ON u.id = dp.user_id
        WHERE 1=1 {status_clause}
        ORDER BY
            CASE lower(v.verification_status::text)
                WHEN 'pending' THEN 0
                WHEN 'rejected' THEN 1
                ELSE 2
            END,
            v.updated_at DESC
        LIMIT 50
    """)

    items = []
    for r in rows:
        item = _row(r)
        # Parse JSON fields that come back as strings
        for json_field in ("registration_doc_json", "plate_lookup_json", "vin_lookup_json",
                           "insurance_summary", "specs_json"):
            val = item.get(json_field)
            if isinstance(val, str):
                try:
                    item[json_field] = json.loads(val)
                except (json.JSONDecodeError, TypeError):
                    pass
        items.append(item)

    return {"items": items, "count": len(items)}


@router.get("/{vehicle_id}")
async def vehicle_detail(
    vehicle_id: UUID,
    _user: TokenPayload = Depends(require_role("operator")),
):
    """Full vehicle record with all documents and lookup data."""
    row = await um().fetchrow("""
        SELECT
            v.*,
            u.id::text AS user_id,
            u.full_name,
            u.email,
            u.phone_number,
            dp.license_url,
            dp.license_number,
            dp.license_state,
            dp.license_expiry_date,
            lower(dp.verification_status::text) AS driver_status,
            dp.provisional_granted,
            dp.provisional_status,
            dp.provisional_expires_at,
            dp.provisional_granted_at
        FROM vehicles v
        JOIN driver_profiles dp ON dp.id = v.driver_id
        JOIN users u ON u.id = dp.user_id
        WHERE v.id = $1
    """, vehicle_id)
    if not row:
        raise HTTPException(404, "Vehicle not found")

    item = _row(row)
    for json_field in ("registration_doc_json", "plate_lookup_json", "vin_lookup_json",
                       "insurance_summary", "specs_json", "links_json", "history_flags"):
        val = item.get(json_field)
        if isinstance(val, str):
            try:
                item[json_field] = json.loads(val)
            except (json.JSONDecodeError, TypeError):
                pass

    return item


class ReviewDecision(BaseModel):
    action: str = Field(pattern="^(approve|reject|resubmit|more_info)$")
    reason: str | None = None
    doc_verified: bool | None = None
    insurance_verified: bool | None = None
    vin_verified: bool | None = None


@router.post("/{vehicle_id}/review")
async def submit_review(
    vehicle_id: UUID,
    body: ReviewDecision,
    user: TokenPayload = Depends(require_role("operator")),
):
    """Accept, reject, or request resubmission for a vehicle."""
    existing = await um().fetchrow("SELECT id, driver_id FROM vehicles WHERE id = $1", vehicle_id)
    if not existing:
        raise HTTPException(404, "Vehicle not found")

    if body.action == "approve":
        await um().execute("""
            UPDATE vehicles
            SET verification_status = 'approved'::vehicleverificationstatus,
                doc_verified = COALESCE($2, doc_verified),
                insurance_verified = COALESCE($3, insurance_verified),
                vin_verified = COALESCE($4, vin_verified),
                updated_at = now()
            WHERE id = $1
        """, vehicle_id, body.doc_verified, body.insurance_verified, body.vin_verified)

        # Check if all vehicles for this driver are now approved → auto-approve driver
        all_approved = await um().fetchval("""
            SELECT COUNT(*) = 0
            FROM vehicles
            WHERE driver_id = $1
              AND lower(verification_status::text) != 'approved'
        """, existing["driver_id"])
        if all_approved:
            await um().execute("""
                UPDATE driver_profiles
                SET verification_status = 'approved'::verificationstatus,
                    is_verified = true,
                    updated_at = now()
                WHERE id = $1
            """, existing["driver_id"])

    elif body.action == "reject":
        reason = body.reason or "Vehicle did not pass manual review"
        await um().execute("""
            UPDATE vehicles
            SET verification_status = 'rejected'::vehicleverificationstatus,
                updated_at = now()
            WHERE id = $1
        """, vehicle_id)

    elif body.action == "resubmit":
        reason = body.reason or "Documents need to be resubmitted"
        # Reset to pending + clear verification flags so driver re-uploads
        await um().execute("""
            UPDATE vehicles
            SET verification_status = 'pending'::vehicleverificationstatus,
                doc_verified = false,
                insurance_verified = false,
                updated_at = now(),
                registration_doc_json = jsonb_set(
                    COALESCE(registration_doc_json::jsonb, '{}'::jsonb),
                    '{resubmit_reason}',
                    $2::jsonb
                )
            WHERE id = $1
        """, vehicle_id, json.dumps(reason))

    elif body.action == "more_info":
        reason = body.reason or "Additional information needed"
        await um().execute("""
            UPDATE vehicles
            SET updated_at = now(),
                registration_doc_json = jsonb_set(
                    COALESCE(registration_doc_json::jsonb, '{}'::jsonb),
                    '{more_info_requested}',
                    $2::jsonb
                )
            WHERE id = $1
        """, vehicle_id, json.dumps({"reason": reason, "requested_at": datetime.now(timezone.utc).isoformat(), "requested_by": user.sub}))

    await log_action(
        user.sub, f"vehicle_review_{body.action}", role=user.role,
        resource="vehicle", resource_id=str(vehicle_id),
        detail={"action": body.action, "reason": body.reason},
    )

    return {"ok": True, "action": body.action, "vehicle_id": str(vehicle_id)}
