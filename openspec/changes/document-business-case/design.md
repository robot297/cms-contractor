# Design: Contractor CMS Business Case & Simple Tracking System

## Design Philosophy

**Simplicity first.** Every feature must pass the "5-10 minute test": can a contractor who hates admin work complete a full status update for all projects in 5-10 minutes? If not, remove it.

## Core Design Principles

1. **Contractor-centric:** Build for tradespeople, not managers. Minimize form-filling, maximize time savings.
2. **Client-centric:** Give clients peace of mind through automatic visibility, not requiring them to log in or chase updates.
3. **Lightweight:** Start with the MVP. Gather client feedback before adding complexity like portals or billing.
4. **Effortless updates:** Status updates should require minimal data entry (project name, status, maybe a note).

## System Architecture

### For Contractors

**Dashboard:**
- Quick overview of all active projects with their clients
- One-click access to update project status
- Visual indication of projects needing updates (e.g., "last updated 3 days ago")

**Status Update Flow:**
- Select project → Select status (Not Started, In Progress, Completed) → Optional note → Save
- Time to complete: 1 minute per project, 5-10 minutes for typical contractor with 5-10 active projects

### For Clients

**Client View:**
- Unique read-only link per project
- Shows: project name, status, start date, estimated completion, last update timestamp
- Optionally: auto-emailed status notifications (e.g., "Your project status updated to In Progress")

**No login required initially** (gather feedback on whether clients need it)

## Implementation Approach

1. **Phase 1 (MVP):** Contractor dashboard + simple status tracking + read-only client link
2. **Phase 2 (Post-validation):** Based on client feedback, add features like:
   - Email notifications for status changes
   - Client portal/login (if needed)
   - Basic timeline view

## Trade-offs

**Simplicity vs. Features:**
- We're deliberately omitting time tracking, billing, invoicing, etc. initially
- Rationale: Adding features now makes the MVP harder to use; validate core value first

**Contractor UX vs. Admin Power:**
- No complex workflows or customization
- Rationale: Contractors won't use complex tools; a simple tool they actually use beats a powerful tool they ignore

## Open Questions for Client Validation

- Do clients prefer email notifications or self-serve checking?
- Is a read-only link sufficient or do they want accounts?
- What else would make contractors' lives easier? (time-tracking? project notes? file uploads?)
