-- 012: Fix tutor + assessor model — model-drift repair.
-- Post-restore migration (auto-applied by run-dev.sh apply_post_restore_sql; idempotent).
--
-- xAI's `grok-4.20-0309-reasoning` now rejects the `reasoning_effort` parameter the
-- pipeline sends (REASONING_LEVEL="high" in api/llm.py): the gRPC call fails with
-- "Model grok-4.20-0309-reasoning does not support parameter reasoningEffort", so EVERY
-- tutor and assessor turn errors out ("Sorry, I had trouble thinking"). This is exactly
-- the "model changed under us" drift the Track A monitoring is built to surface.
--
-- Fix: point the tutor + full_assessor roles at `grok-4.3`, which supports
-- reasoning_effort (none/low/medium/high) and was verified to complete real turns.
-- Idempotent — only rewrites rows still pointing at the broken model. An operator can override
-- the model choice here or via the Red Team learning-system UI.

UPDATE learning_system_schemas
SET descision_tree = jsonb_set(descision_tree, '{config,llm_roles,tutor,model}', '"grok-4.3"')
WHERE descision_tree->'config'->'llm_roles'->'tutor'->>'model' = 'grok-4.20-0309-reasoning';

UPDATE learning_system_schemas
SET descision_tree = jsonb_set(descision_tree, '{config,llm_roles,full_assessor,model}', '"grok-4.3"')
WHERE descision_tree->'config'->'llm_roles'->'full_assessor'->>'model' = 'grok-4.20-0309-reasoning';
