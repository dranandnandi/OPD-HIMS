# Suite Admin documentation bundle

Current implementation backlog and user release steps: [20 October status](SUITE_PENDING_STATUS.md). The complete four-app implementation is still unfinished.

Start with [project memory](../MEMORY.md) and [project instructions](../AGENTS.md). These carry the current scope, user decisions, completed work and unverified deployment status when this folder is moved to a new repository.

## Current suite documents

- [Manual payments, invitations and operations handoff](SUITE_OPERATIONS_HANDOFF.md)
- [Implementation and deployment](SUITE_ADMIN_IMPLEMENTATION.md)
- [Messaging backend integration plan](SUITE_MESSAGING_INTEGRATION_PLAN.md)
- [Local integration handoff, server settings and rollout order](LOCAL_INTEGRATION_HANDOFF.md)
- [Original platform architecture and plans](DOCTOR_SUITE_PLATFORM_PLAN.md)
- [Copy manifest and source paths](COPY_MANIFEST.md)

These plans and the integration handoff are snapshots from the OPD repository. Paths such as `supabase/functions/...`, `suite-integrations/...`, `supabase/migrations/...` and `tests/...` inside them refer to that repository, not to this standalone frontend. Its backend code has not been duplicated here. References to `suite-admin/...` describe this folder's original nested location.

## Archived product references

- [OPD user management](reference/opd/USER_MANAGEMENT_ARCHITECTURE.md)
- [OPD WhatsApp integration](reference/opd/WHATSAPP_INTEGRATION.md)
- [OPD WhatsApp auto-send](reference/opd/WHATSAPP_AUTO_SEND_INTEGRATION.md)
- [Earlier OPD WhatsApp plan](reference/opd/whatsapp_integration_plan.md)
- [Growth repository instructions](reference/growth/copilot-instructions.md)
- [WhatsApp repository instructions](reference/whatsapp/copilot-instructions.md)
- [Workforce repository instructions](reference/workforce/copilot-instructions.md)

Archived files apply to their source product and may describe older implementations or proposed work. Their embedded relative links refer to the original repository. Do not run their deployment commands against Suite Admin. Credential-related examples have been omitted where detected. The current source audit and messaging plan take precedence over old architecture assumptions.

Unrelated OPD clinical/ABDM/mobile documents and LIMS-inclusive historical pricing are excluded because they do not define this suite's scope or pricing. No existing standalone project memory was found; `MEMORY.md` records the current conversation's project handoff instead.
