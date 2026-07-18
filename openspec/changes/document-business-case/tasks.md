# Tasks: Implement Contractor CMS Business Case Documentation

## Phase 0: Establish Shared Understanding (Current)

- [x] Interview stakeholders to understand the core problem
- [x] Validate contractor vs. client pain points
- [x] Document business case and success metrics
- [x] Define MVP scope and design principles
- [x] Identify client validation questions

## Phase 1: Build MVP (Contractor Dashboard + Status Tracking)

### Backend Setup
- [x] Design database schema for projects, contractors, clients, and status updates
- [x] Create API endpoints for:
  - GET /api/projects (list contractor's projects)
  - POST /api/projects (create new project)
  - PUT /api/projects/:id/status (update project status)
  - GET /api/public/projects/:token (get project details for read-only client view)
  
### Frontend: Contractor Dashboard
- [x] Create projects list view with status overview
- [x] Implement quick status update modal (1-minute flow)
- [x] Add "last updated" timestamps to encourage regular updates
- [ ] Build contractor login/auth (simple for MVP)
- [ ] Test: Can a contractor update 5 projects in 10 minutes?

### Frontend: Client View
- [x] Create public read-only project view (no auth required)
- [x] Generate unique, shareable links per project
- [x] Display: project status, dates, last update time
- [x] Make it mobile-friendly (clients will check on-the-go)
- [x] Add Vue Router for public view routes

### Testing & Validation
- [ ] Test MVP with 2-3 real contractors
- [ ] Gather feedback on:
  - Is 5-10 minute update time achievable?
  - What's missing for their workflow?
  - Do clients need anything else to feel confident?
- [ ] Document findings

## Phase 2: Post-MVP Enhancements (After Client Feedback)

- [ ] Email notifications for status changes (if requested)
- [ ] Client account/login (if requested)
- [ ] Project timeline view
- [ ] Notes/comments per project
- [ ] File upload for project files (if requested)

## Definition of Done

A feature is "done" when:
- Code is written and tested
- Passes the "5-10 minute" principle (doesn't add friction for contractors)
- Ready for contractor feedback
- Documented for future development

## Success Criteria for MVP

1. Contractor can view all projects in one place
2. Contractor can update project status in <5 minutes total
3. Clients can view read-only project status without login
4. System successfully reduces need for status update emails
5. Contractors report improved confidence in client relationships
