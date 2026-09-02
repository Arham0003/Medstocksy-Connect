# Feature Specification: Confirm Before Action (Yes/No Guard)

**Feature Branch**: `002-confirm-before-action`

**Created**: 2026-08-29

**Status**: Draft

**Input**: User description: "For every direct yes by clicking, make it always ask Do you want then YES and NO. Like in profile of customer there is chronic button if user clicks that directly turn to yes but make it Do you want to? YES OR NO. Do that for everything in the app that directly changes."

## User Scenarios & Testing

### User Story 1 - Chronic Tag Toggle Confirmation (Priority: P1)

Staff clicks the chronic tag chip on a customer profile. Instead of immediately toggling, a dialog appears asking "Do you want to?" with YES and NO buttons. Only YES changes the tag.

**Why this priority**: The chronic tag drives automated refill reminder priority. Accidental toggles have immediate messaging side-effects.

**Independent Test**: Open any customer profile. Click chronic chip. Confirm dialog appears. Click NO — tag unchanged. Click chip again, click YES — tag changes.

**Acceptance Scenarios**:
1. Given customer NOT chronic, When staff clicks the chip, Then dialog "Mark as chronic? YES / NO" appears.
2. Given dialog shown, When NO clicked, Then dialog closes and tag unchanged.
3. Given dialog shown, When YES clicked, Then tag toggles.
4. Given customer IS chronic, When staff clicks chip, Then dialog reads "Remove chronic tag? YES / NO".

---

### User Story 2 - WhatsApp Opt-in / Opt-out Confirmation (Priority: P1)

Staff clicks the opt-in/opt-out badge. Replace native browser prompt/confirm with a styled dialog with YES/NO. The opt-out reason input moves inside the dialog.

**Acceptance Scenarios**:
1. Given customer opted in, When badge clicked, Then dialog "Opt this customer out?" appears.
2. Given customer opted out, When badge clicked, Then dialog "Opt this customer back in?" appears.
3. Given opt-out YES, Then reason-input field appears in same dialog before final confirm.

---

### User Story 3 - Prescription Renew Confirmation (Priority: P2)

Staff clicks the renew icon. Dialog "Renew this prescription?" appears before duplicating.

**Acceptance Scenarios**:
1. Given prescription visible, When renew icon clicked, Then dialog appears.
2. Given NO, Then nothing changes.
3. Given YES, Then prescription renewed.

---

### User Story 4 - Member Remove / Invite Revoke Confirmation (Priority: P2)

Trash icon for member remove or invite revoke shows YES/NO dialog before acting.

**Acceptance Scenarios**:
1. Given admin clicks remove member, When NO, Then member not removed.
2. Given admin clicks revoke invite, When YES, Then invite revoked.

---

### User Story 5 - Member Role Change Confirmation (Priority: P2)

Changing role dropdown fires YES/NO dialog. If NO, dropdown reverts.

**Acceptance Scenarios**:
1. Given dropdown changed, When dialog shown with new role name, When NO, Then dropdown reverts.
2. Given YES, Then role updated.

---

### User Story 6 - Template / Campaign Draft Delete Confirmation (Priority: P2)

Delete buttons in Template and Campaign dialogs show YES/NO confirmation.

**Acceptance Scenarios**:
1. Given Delete clicked, Then dialog "Delete this template?" or "Delete this draft?" appears.
2. Given YES, Then item deleted and dialog closed.

---

### User Story 7 - Reminder Send / Skip / Retry Confirmation (Priority: P2)

Mark-sent, skip, and retry actions on reminders (in Reminders page, RemindersBell, TodayRemindersPopup) show YES/NO before firing.

**Acceptance Scenarios**:
1. Given Send button on pending reminder, When clicked, Then "Send this reminder now?" dialog appears.
2. Given Skip, Then "Skip this reminder?" dialog appears.
3. Given Retry, Then "Retry sending this reminder?" dialog appears.

---

### Edge Cases

- Rapid double-click: only one dialog appears (trigger button disabled while dialog open)
- Escape key = NO
- Dialog is keyboard accessible
- Confirmation text reflects current state accurately
- All window.confirm / window.prompt removed

## Requirements

### Functional Requirements

- **FR-001**: System MUST show YES/NO dialog before any direct-mutate button action (actions not behind a form with a Save button)
- **FR-002**: Dialog MUST use the existing styled Dialog component — no native browser dialogs
- **FR-003**: NO / Escape MUST leave data unchanged
- **FR-004**: YES MUST fire the original mutation
- **FR-005**: YES button disabled and shows spinner while mutation pending
- **FR-006**: Dialog text reflects the specific action and current state
- **FR-007**: Single reusable ConfirmDialog component used everywhere
- **FR-008**: Opt-out reason input moves inside the ConfirmDialog, replacing window.prompt
- **FR-009**: All window.confirm and window.prompt calls removed from src/
- **FR-010**: Role-change select reverts to previous value if user cancels

### Key Entities

- **ConfirmDialog**: props: open, onConfirm, onCancel, title, description, confirmLabel (default "Yes"), cancelLabel (default "No"), isPending, children (for optional inline inputs like opt-out reason)
- **Pending action state**: Each call site holds local state controlling dialog visibility

## Success Criteria

- **SC-001**: Zero window.confirm / window.prompt calls in src/ after implementation
- **SC-002**: Every direct-mutate button has a YES/NO step
- **SC-003**: Single shared ConfirmDialog component
- **SC-004**: NO / Escape leaves data unchanged
- **SC-005**: Opt-out reason input works inside dialog

## Assumptions

- Existing Dialog/DialogContent/DialogFooter in src/components/ui/dialog.tsx reused
- Form submit actions excluded (already have Cancel buttons)
- Delete customer already has its own Dialog — keep as-is, no change
- BatchRefillDialog / RefillDialog saves are form submissions — excluded
- Add-as-family-member is part of collision UI flow — excluded
