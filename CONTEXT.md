# Contractor CRM

A lightweight platform where **Contractors** track their work and give their **Customers** visibility into project progress. This context covers the contractor-facing customer directory and the customer-facing portal.

## Language

**Contractor**:
The tradesperson or firm that logs in to track work and communicate status. Owns their own customer list.
_Avoid_: Vendor, provider.

**Customer**:
A contractor-scoped contact record that one Contractor tracks. Belongs to exactly one Contractor. Identified by email (`(contractorId, email)` unique). May link to at most one User account.
_Avoid_: Client (used loosely in older docs), buyer, contact-as-a-separate-thing.

**Linked / Unlinked Customer**:
A Customer is _Linked_ once someone accepts its Invite and a User binds to it; _Unlinked_ before that. An Unlinked Customer's email is editable (and editing revokes pending Invites); a Linked Customer's email is read-only.

**Archived Customer**:
A Customer whose state has been set to archived — removed from the Directory and "select existing" but never deleted; the record and its Orders are preserved. Archiving always updates state (reversible), never deletes, and is confirmed before it takes effect.

**User**:
A login identity (a `user` row / better-auth account) with a `role` of `contractor`, `customer`, or `subcontractor`. Distinct from a Customer or Subcontractor record. A User holds exactly one role globally: the same real person cannot be both a Customer and a Subcontractor (or a Contractor and a Subcontractor) under one login — an Invite that would create such a collision is refused. See [ADR-0002](docs/adr/0002-one-role-per-user.md).
_Avoid_: Account (ambiguous — could mean User or Customer or Subcontractor).

**Subcontractor**:
A contractor-scoped record for a trade partner the Contractor delegates work to. Belongs to exactly one Contractor and may Link to at most one User via a Subcontractor Invite — mirroring the Customer record↔User pattern (the same trade person under two Contractors = two Subcontractor records → one User). Carries a profile the Contractor administers (trade/specialty, contact, company, license #, insurance) and an access Tier. A Subcontractor is assigned to Orders to receive work.
**Workers** is the plural the Order workspace uses on screen — the tab listing who is assigned to a job — because that panel is about the people on this job rather than about the records. The entity is still a Subcontractor everywhere else, singular and in the code.
_Avoid_: Vendor, crew, contractor (a Subcontractor is a distinct record, not a Contractor User); _worker_ as the name of the entity — it is a UI plural for a set of Assignments, not a synonym for the record.

**Tier (Trusted Subcontractor / Guest Contractor)**:
An access level the primary Contractor assigns to each Subcontractor, gating both visibility and write access on assigned Orders. A **Trusted Subcontractor** sees the full Order (including the Customer's contact details + timeline) and may write back (timeline notes, job photos). A **Guest Contractor** sees work details only — project, type, status, work timeline — with the Customer's contact PII redacted, and is read-only. The Tier lives on the Subcontractor record and applies to all their assignments.
_Avoid_: Permission, role (role is a User concept; Tier is a Subcontractor-record concept).

**ID Scan**:
Filling the Add/Edit Subcontractor form by photographing the Subcontractor's ID instead of typing it. Two paths: the PDF417 barcode on the back of a US/CA licence, decoded on the contractor's own device, and — for a card with no barcode, such as a trade licence — sending the photo to be read, which is off entirely unless the deployment configures it. An ID Scan never writes: it prefills a form the Contractor then reviews and saves, so every rule that governs a typed entry still governs a scanned one.
_Avoid_: OCR (only one of the two paths is optical), verification (a scan captures what the card says, it does not vouch for it), import.

**Scanned ID**:
What one ID Scan read: a name, a single-line address, a document number, a date of birth and an expiry, plus which path produced it. A Scanned ID is never stored — neither is the photo. Only the name and address prefill a Subcontractor; the rest is shown on the confirm step so the Contractor can see the scan read the right card, then discarded with the image. The one exception is a trade licence read by vision, whose number is what `licenseNumber` on a Subcontractor actually means — a driver's licence number never fills that field.
_Avoid_: Document (a Document is a stored artifact; a Scanned ID is deliberately not stored), record.

**Subcontractor Invite**:
A magic/invite link a Contractor sends so a Subcontractor can access their portal, bound to the Subcontractor record by token (email is a fallback) — the same load-bearing binding as the customer Invite ([ADR-0001](docs/adr/0001-bind-customer-to-user-by-invite-token.md)), implemented as a parallel mechanism rather than by generalizing the customer Invite. See [ADR-0003](docs/adr/0003-parallel-subcontractor-invite.md).
_Avoid_: Signup, registration.

**Assignment**:
The link that puts a Subcontractor on an Order (many-to-many: an Order may have several assigned Subcontractors; a Subcontractor's portal lists the Orders assigned to them). Assignment is what makes an Order appear as a Subcontractor's "work".
_Avoid_: Dispatch, allocation.

**Invite**:
A magic/invite link a Contractor sends so a Customer can access their portal. The Contractor initiates it; Customers do not self-register.
_Avoid_: Signup, registration.

**Directory**:
A Contractor's private, searchable list of their own Customers, independent of whether any Order references them. Its ONLY source is Customers the Contractor created. "Select existing" means reusing one of your own repeat Customers on a new Order — never discovering another Contractor's Customers or self-registered accounts.

**Order**:
A unit of tracked work a Contractor performs for a Customer, with a lifecycle state and a timeline. Links to one Customer.
_Avoid_: Project (used in older business proposal), job, ticket.

**Timeline**:
The record of what happened to an **Order** — status changes, notes, milestones, a **Document** arriving. Shown to the **Contractor** and the **Customer** as **History**, which is what both surfaces call it on screen; _Timeline_ remains the name of the entity and the table.
_Avoid_: Feed, activity, log; and do not use _Timeline_ as a UI label — the two surfaces agreed on History and drifting back would split them again.

**Order State** / **Stage**:
An Order carries one of ten **Order States** — the Contractor's workflow, from _Inquiry_ to _On Hold / Archived_. The **Customer** is told all ten, in their own words: _Deposit Pending_ reads as "Deposit due", _Inquiry_ as "Received". What the Customer is shown as a progress rail is the coarser **Stage** — Pending, Scheduled, In Progress, Completed — because a rail with ten dots is unreadable on a phone. The two answer different questions and are allowed to look out of step: the Stage says how far along the job is, the State says what is happening now. Cancelled and On Hold are neither — they are departures from the rail rather than points on it.
_Avoid_: Status (ambiguous between the two), phase.

**Portal**:
The surface a **Customer** or **Subcontractor** sees — their own work and nothing else, reached by **Invite** rather than by signing up. The Contractor's own app is not a Portal. Each Portal is scoped to the records its holder is linked or assigned to, and none of them consults a **Subscription** ([ADR-0005](docs/adr/0005-lapsing-never-reaches-customers.md)).
_Avoid_: Dashboard (the Contractor's word), client area, account page.

**Message**:
One thing said about an **Order**, written by the **Contractor** or by the **Customer**, and visible to both. A Message is _not_ a **Timeline** entry: the Timeline records what happened to the job, a Message records what someone said about it. Only a Message carries an author who could have said something else.
_Avoid_: Note (an internal note is a Timeline entry the Customer never sees), request, comment, update.

**Topic**:
What a **Customer**'s **Message** is about — a question, a payment matter, scheduling, or a reported problem. **Dormant**: the quick actions that set it have been removed from the portal, so every new Message is _general_. Messages sent while the actions existed keep their Topic and still display it, and the column and the labels remain — this is a UI that was taken away, not a concept that was deleted. Anything that reintroduces it needs to decide whether a Topic is worth asking a Customer for at all.
_Avoid_: Category, type (a **Feedback** has a type — bug or feature — which is a different thing), priority.

**Thread**:
The ordered set of **Messages** on one **Order** — exactly one per Order, read oldest-first, never deleted. Both ends see the same Thread; each side separately tracks which of the other's Messages it has read, so an unread count means "waiting on you" rather than "new to everyone".
_Avoid_: Conversation (fine in prose, but the Thread is the object), inbox, chat.

**Document**:
One file on one **Order** — a quote, a permit, a receipt, a sign-off sheet, the photo of the meter reading. A Document records what it is called, what type it is, who uploaded it (both their role and which **User**), and when it arrived. It is always owned by the Order's **Contractor**, whoever sent it, because ownership follows the job rather than the sender. Any role may add one through the same upload path, and every surface opens one the same way: over the page, never by navigating at the file.
_Avoid_: Attachment (the old word — retired), file (fine in prose; a Document is the object), upload (that is the act, not the thing), asset.

**Withdraw**:
A **Customer** removing a **Document** they sent, allowed only until their **Contractor** has read it. Once read it stays: a Document that has been seen is a record of what was exchanged, not a draft. This is not the same as the Contractor's _delete_, which applies to any Document on their own Order at any time. The rule needs its own name in the code — `withdrawDocument` is not `deleteDocument` — but the Customer is not asked to learn it: the control says **Remove**, and where it is gone the portal says the Contractor has seen the file.
_Avoid_: Unsend, recall, take back, undo (as UI copy — the code keeps _withdraw_ for the rule).

**Subscription**:
A Contractor's billing standing. Every Contractor has exactly one, created the moment they sign up and never absent. Its status is `trialing`, `active`, `past_due`, `lapsed`, or `comped`. Only Contractors have one — Customers and Subcontractors arrive by Invite and never pay.
_Avoid_: Account (see Flagged ambiguities), plan, membership, licence.

**Trial**:
The first 14 days of a Subscription. Every feature is available; only the volume of records is capped by Trial Limits. Starts automatically at sign-up with no card, and needs no action to begin or to end.
_Avoid_: Free tier (there isn't one — the Trial ends), evaluation, demo (Demo Mode is a separate, seeded shared login).

**Trial Limit**:
The maximum number of _active_ Customers, Orders, or Subcontractors a Contractor may hold during their Trial. Counted over live records only, so Archiving a Customer or deleting an Order frees capacity. Limits exist only during the Trial — a paid Subscription is unlimited.
_Avoid_: Quota, cap-on-everything (Limits never restrict features, only counts).

**Lapsed**:
The state of a Contractor whose Trial ended or whose payment failed past recovery. They keep full read access to everything they built, and every write is refused behind an upgrade prompt. Lapsing never deletes, hides, or archives anything, and never reaches their Customers or Subcontractors.
_Avoid_: Suspended, disabled, expired, locked out (nothing is taken away).

**Comped**:
A Subscription granted permanently at no charge and with no Stripe record — held by the Contractors who predate billing and by the Demo Mode contractor. Behaves exactly like a paid Subscription and never lapses.
_Avoid_: Free plan, internal account, beta.

**Guide**:
The getting-started checklist a Contractor sees on their dashboard, walking them along the path the product requires anyway: add a Customer, create an Order for them, then optionally invite that Customer to their portal, learn how follow-ups work, and assign a Subcontractor. A Guide is _active_ until the Contractor says otherwise; completing the first two steps offers a fork — _extended_ (show the remaining steps) or _dismissed_. Only that choice is remembered; whether a step is done is always read back from the Contractor's real Customers, Orders, Invites and Assignments, so the Guide can never disagree with the account it describes. The single exception is the follow-up step, which teaches rather than asks and is completed by acknowledgement.
_Avoid_: Onboarding (ambiguous with signup and with the Invite flow), tour, wizard, walkthrough.

## Relationships

- A **Contractor** owns many **Customers** (contractor-scoped).
- A **Customer** links to at most one **User** account (set when the Customer accepts an **Invite**).
- The same real person working with two **Contractors** = two **Customer** records pointing at one **User**.
- A **Contractor** sends an **Invite** to a **Customer**; the Customer does not self-register.
- Accepting an **Invite** binds the accepting **User** to the **Customer** via the Invite's token (email match is a fallback). A **User** may link to at most one **Customer** per **Contractor**.
- An **Order** belongs to one **Contractor** and references one **Customer**.
- Every **Order State** maps to exactly one customer-facing label and one **Stage**. Both mappings are exhaustive by construction: adding an eleventh State is a type error, not a state that quietly reports as _Pending_ — which is what happened to _Final Payment Pending_, whose absence sent the Customer's rail backwards to the first step on a job whose work was finished.
- An **Order** has exactly one **Thread**, holding the **Messages** between its Contractor and its Customer. A Message never appears on the Order's **Timeline**, and a Timeline entry is never a Message.
- An **Order** holds many **Documents**, and a **Document** belongs to exactly one Order. Every Document on an Order is owned by that Order's **Contractor**, regardless of which role uploaded it.
- A **Customer** sees only the **Documents** they sent themselves. What their **Contractor** has filed on the same Order stays the Contractor's until sharing exists as a concept — a deliberate hold, restated here so it is not lost by accident.
- A **Subcontractor** sees the **Documents** on Orders they are assigned to. **Tier** governs writing one exactly as it governs a timeline note: a Trusted Subcontractor may upload, a Guest Contractor may only read.
- A **Lapsed** Contractor may not upload a **Document**; their **Customer** and their assigned **Subcontractors** still may ([ADR-0005](docs/adr/0005-lapsing-never-reaches-customers.md)).
- A **Customer**'s **Portal** shows every **Order** across all their Customer records, so the same person working with two Contractors sees both sets of work in one place.
- A **Message** from a Customer is unread to the **Contractor** until they open the Thread, and vice versa — read state is per side, never shared.
- A **Lapsed** Contractor may not send a **Message**; their **Customer** may still send one and is still delivered a notification to the Contractor ([ADR-0005](docs/adr/0005-lapsing-never-reaches-customers.md)).
- A **Contractor** owns many **Subcontractors** (contractor-scoped, exactly as with Customers).
- A **Subcontractor** links to at most one **User** account (set when it accepts a **Subcontractor Invite**), and a **User** holds one global role — so a login is never both a Customer and a Subcontractor.
- A **Subcontractor** is assigned to many **Orders**, and an **Order** may have many assigned **Subcontractors** (**Assignment**).
- A Subcontractor's **Tier** (Trusted Subcontractor vs Guest Contractor) determines what they see and whether they can write on their assigned **Orders**.
- Every **Contractor** has exactly one **Guide**, and only Contractors have one — **Customers** and **Subcontractors** arrive by **Invite** into their own portals and never see it.
- A **Guide**'s steps are derived from the Contractor's own **Customers**, **Orders**, **Invites** and **Assignments**; only the Contractor's continue-or-dismiss choice is stored.
- Every **Contractor** has exactly one **Subscription**, created at sign-up; **Customers** and **Subcontractors** never have one and are never billed.
- A **Subscription** begins as a **Trial** and, if unpaid, becomes **Lapsed** — it is never absent and never deleted.
- **Trial Limits** are measured against a Contractor's _active_ **Customers**, **Orders** and **Subcontractors**; Archiving is therefore a real remedy for a Contractor at their Limit.
- A **Lapsed** Subscription gates only that **Contractor's** own writes. Their **Customers** and assigned **Subcontractors** keep full portal access, including writing back. See [ADR-0005](docs/adr/0005-lapsing-never-reaches-customers.md).
- Paid **Subscriptions** are priced per **Contractor**, so a firm scales by buying more Contractor logins rather than by moving between plans. See [ADR-0006](docs/adr/0006-one-plan-priced-per-contractor.md).

## Example dialogue

> **Dev:** "When a **Customer** signs up on their own, do they show up in a **Contractor's** directory?"
> **Domain expert:** "Customers don't sign up on their own. The **Contractor** creates the **Customer** record first, then sends an **Invite**. The Customer only ever appears because a Contractor put them there."

> **Dev:** "Dana's **Trial** ran out last night. Her customer Sam opens his portal this morning — what does he see?"
> **Domain expert:** "Exactly what he saw yesterday. Sam isn't the one who didn't pay. Dana is **Lapsed**, so Dana can't post an update or send an **Invite** — but Sam's portal, his timeline, his ability to send a request, all of it keeps working. We sell Dana a reputation with her customers; we don't take it hostage."

> **Dev:** "Dana's at her **Trial Limit** of 25 Customers and wants to add one more. Does she have to pay?"
> **Domain expert:** "Only if all 25 are live work. Limits count active records, so if she Archives three finished jobs she's at 22 and can carry on — nothing is lost, and she can unarchive any of them later. The Limit is about how much she's juggling now, not how much she's ever done."

## Flagged ambiguities

- "Client" vs "Customer": older docs (BUSINESS_PROPOSAL.md) say "client"; canonical term is **Customer**.
- "Account": used to mean both **User** (login) and **Customer** (contact record) — these are distinct.
- "No login for clients" (BUSINESS_PROPOSAL.md:66) was reversed in the actual codebase: Customers DO authenticate via magic-link **Invite**. The proposal's anonymous-shareable-link model is not what was built.
- "Tier": `src/routes/pricing/+page.svelte` shipped a `tiers` array of pricing levels (Solo / Crew / Contractor Pro), colliding with **Tier** as defined above (Trusted Subcontractor vs Guest Contractor). Resolved: **Tier** is exclusively a Subcontractor-record concept. There are no pricing tiers — there is one paid **Subscription** priced per Contractor, so the pricing page's `tiers` array is to be removed outright rather than renamed.
- "Payments": the **Order** lifecycle includes states named _Deposit Pending_ and _Final Payment Pending_. Those describe money moving between a **Contractor** and their **Customer**, which this product only ever tracks as a status — it never handles it. The only money this product moves is a Contractor's **Subscription**. This used to need careful handling, because the portal offered a **Make a payment** quick action that was really a message and had to say so on screen. Removing the quick actions removed the problem: there is now no control in the portal that could be mistaken for a payment rail.
- "Attachment" vs **Document**: the storage layer, the UI and the docs each used a different word for the same thing — `attachment` in the table, "Documents" on the portal, "Files" in the contractor's workspace. Resolved: the concept is a **Document**, the table is `document`, and _Attachment_ is retired rather than kept as a synonym. "Files" survives only as a tab label.
- **Document** ideas deliberately NOT built, inherited from the superseded `customer-documents` change and named here so they read as decisions rather than as omissions: **sharing** a Contractor's Document with their Customer (needs a decision about default visibility that nothing currently forces); **response requests** (asking the Customer to send a specific document back); **versioning**, **e-signature** and **virus scanning**; and **object storage** — bytes stay in Postgres and the seam to move them exists, but the S3 backend does not, because migrating existing bytes is its own risk. Tags and notes on a Document _were_ built. Multi-file upload makes an Order's row footprint grow faster than before, so the object-storage move is owed sooner than it was.
- Seats: pricing is per Contractor, but a company buying several Contractor logins under one bill is not built. Until it is, one **Subscription** covers exactly one Contractor; a firm buys separate Subscriptions.
- "Waiting" as alarm vs as work: a count of unanswered Customer messages was rendered in the destructive red on the nav and inside an Order, and in the brand accent on the dashboard and the Orders list — each with a comment defending its choice. So the same number read as routine on one screen and as a fault on the next. Resolved: an unanswered message is the **Contractor's normal work queue**, not an error, so waiting counts wear the accent and `--danger` is reserved for destructive actions and error states. See [ADR-0009](docs/adr/0009-waiting-counts-use-the-accent-not-danger.md).
