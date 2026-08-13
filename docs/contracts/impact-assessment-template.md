# State Machine Impact Assessment

Required in the plan for ANY change touching `api/session_engine.py` or the
tutoring transitions. Answer before writing code.

1. **Which states / transitions / interaction_types change?** (list each)
2. **New contract version?** (e.g. z-sm-v006.5 -> v006.6) and the changelog line.
3. **Why is each change an improvement** over the current documented behavior?
4. **What is different for a student mid-session** as a result?
5. **Flag interaction:** does any change depend on a feature flag? Which states?
6. **Sync checklist:** will this PR update `api/state_machine/zsm-v006.json`
   (version + changelog), `api/tests/test_state_machine_contract.py`, and any
   affected docs — in the same PR? (Y/N — must be Y to merge.)
