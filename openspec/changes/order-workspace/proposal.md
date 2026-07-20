## Why

Orders currently live on the contractor dashboard, carry no project context (just a customer + lifecycle state), and rely on an automatic, state-based "needs attention" flag the contractor can't control. Contractors need a real Orders workspace: name the project, say what kind of structure it is, and decide themselves when the next follow-up is (and snooze it) rather than being told by a rigid rule. They also want to put a face to a customer with a quick photo.

## What Changes

- Add a dedicated **`/contractor/orders`** page that hosts the order list and New Order flow; move order display off the dashboard and add **Orders** to the contractor nav (Dashboard / Orders / Customers).
- Orders gain a **project name** and a **project type** — a selector of shelter options (Gazebo, Pavilion, Pergola, Carport, Pole Barn, Shed, Deck) plus an **Other** free-text option.
- The **New Order** modal collects: project name, the customer it's for (a searchable picker, pre-filled when launched from a known customer), and the project type.
- **Replace the automatic "needs attention" signal** with a contractor-controlled **next follow-up date**: set it, **snooze** it (+1 day / +3 days / +1 week / custom), and clear it. The workspace surfaces orders whose follow-up is **due**. The old state-based needs-attention badge is removed.
- Customers gain an **avatar photo** the contractor captures with the device camera, stored as a downscaled data URL on the customer record.

## Capabilities

### New Capabilities
- `order-workspace`: The Orders page, order project name/type, and contractor-controlled follow-up scheduling (set / snooze / due surfacing), replacing the automatic needs-attention signal.
- `customer-avatar`: Capturing and displaying a customer's photo avatar (camera capture, stored as a data URL).

### Modified Capabilities
<!-- The customer-directory capability is not yet synced to openspec/specs, so avatar is introduced as a new capability rather than a delta. -->

## Impact

- **Data model** (`src/lib/server/db/schema.ts`): `order` gains `projectName`, `projectType`, `nextFollowUpAt` (nullable); `customer` gains `avatar` (text data URL, nullable). Migration in `drizzle/`.
- **Domain** (`src/lib/crm.ts`): project-type list + validation, follow-up helpers (is-due, snooze date math), avatar size/type validation — shared via Zod.
- **Server** (`src/lib/server/crm.server.ts`): `createOrder` accepts project name/type; new `setFollowUp`/`snoozeFollowUp`/`clearFollowUp`; `setCustomerAvatar`; order views expose project fields + follow-up due state; drop `ATTENTION_STATES`/`needsAttention`.
- **Routes**: new `src/routes/contractor/orders/+page.{server.ts,svelte}`; dashboard (`contractor/+page.svelte`) loses the order list + New Order; nav (`contractor/+layout.svelte`) gains Orders; customer directory gains avatar capture/display.
- **Tests**: project-type + follow-up + avatar domain helpers.
