# Glossary

**Router**: the plugin. It picks a model family and effort for each turn, subagent and Codex call.

**Model family**: a line of models by size, such as Haiku, Sonnet, Opus, Fable, or a Codex family. The router always means the newest model in the family. A version name written anywhere (an agent file, a skill) is read as "this family".

**Tier**: a model family plus an effort level, such as "Haiku medium" or "Opus high".

**Main tier**: the tier a session runs on when nothing else applies. Today it is Opus medium.

**Task class**: the router's name for a kind of work, such as explore, final-copy or debugging. Each class maps to one tier.

**Floor**: a class whose tier never goes below the main tier. Example: final copy the audience will see.

**Sure**: the router is confident enough about a class to move the main chat. Either a rule matched, or the classifier gave 0.85 or more.

**Auto switch**: the main chat's own turn runs on a cheaper tier because its class is sure and allowed to move. The next prompt starts on the main tier again.

**Follow-up**: a message that continues the current task ("ok, do it", "and the tests too"). It keeps the current class.

**Explicit ask**: a model or effort named in the prompt itself ("use haiku for this", "think hard"). It wins over everything for that turn, floors included.

**Outside agent**: another vendor's coding agent that Claude calls for a second opinion or a side job: Codex or Antigravity. Claude calls them only through the router.

**Agent role**: why Claude calls an outside agent: review, validate, deep, quick or visual. The role picks that agent's model family and effort.

**Eval case**: one made-up, anonymized prompt with the context it needs and its needed tier.

**Category**: a group of eval cases, either one task class or one tricky group (follow-ups, Russian, very short, mixed tasks, misleading words, project-specific meaning, explicit asks).

**Needed tier**: the cheapest tier that still gives top-quality work for an eval case. Two labeler models must agree; where they differ, the owner decides.

**False cheap**: the router picked a lower tier than the needed tier. This is the costly error.

**False dear**: the router picked a higher tier than the needed tier. It only wastes money.

**Baseline**: the first eval run, made before any tuning. It shows how the router works as built.
