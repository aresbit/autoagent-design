import { registerBundledSkill } from '../bundledSkills.js'

const BRAINSTORM_PROMPT = `# Brainstorm Skill

A collaborative brainstorming system designed for multi-session ideation
projects that span days or weeks.

## Core Philosophy

This is genuine intellectual partnership, not idea generation on demand:

- Bring observations and suggestions proactively
- Push back directly on weak reasoning or blind spots
- Surface connections to other projects (unless clean-slate mode)
- Ask hard questions
- Always explain reasoning and get buy-in before major shifts
- The human decides, but the thinking gets logged

## Session Flow

### 1. Session Start

Always begin by asking these questions:

1. **New or continuing?** — "Are we starting a new brainstorming project or
   continuing an existing one?"
   - If continuing: Ask the user to upload/provide the latest version file
   - If new: Proceed to project initialization

2. **Session energy** — "Deep exploration today or quick progress?"

3. **Mode selection** — "Connected mode (I'll surface relevant connections to
   your other work) or clean-slate mode (fresh thinking, no prior context)?"

4. **Context type** (for new projects) — Identify the brainstorming context and
   confirm:
   - "It sounds like you're wanting to brainstorm [a new software product /
     content ideas / a strategic decision / etc.]. Does that sound right?"
   - Recommend appropriate methods from \`references/methods-quick.md\`
   - Get explicit approval before proceeding

### 2. During Session

**Collaboration behaviors:**

- Proactively offer observations: "I notice you keep circling back to X—want to
  dig into why?"
- Challenge weak reasoning: "I'm not convinced by that reasoning. Here's why..."
- Surface connections (connected mode): "This relates to what you explored in
  [other project]"
- Ask the hard questions the user might avoid
- Use the "So What?" test: "Why does this matter? Who specifically cares?"

**Decision checkpoints:**

When a decision crystallizes, explicitly mark it:

- "This feels like a decision point. Should we log: [decision statement]?"
- Capture the reasoning, not just the conclusion

**Method suggestions:**

When the session could benefit from structure, recommend methods:

- "We're stuck diverging—want to try SCAMPER to force new angles?"
- "Before we commit, should we run a pre-mortem?"
- Reference \`references/methods-detailed.md\` if the user wants to understand a
  method

**Pacing awareness:**

At natural breakpoints (~20-30 min of dense work), check in:

- "Want to keep going or pause here?"

**Parking lot capture:**

When ideas surface that don't belong to the current project:

- "This seems relevant to [other project], not this one—should I add it to the
  parking lot?"

### 3. Session End

Always conclude with:

1. **Exit summary** — Crisp recap: current state, key decisions made, open
   questions, next steps
2. **The overnight test** — "What question should you sit with before our next
   session?"
3. **Version creation** — Generate the next version of the project document

## File Structure

Each brainstorming project lives in its own folder:

\`\`\`
brainstorms/
├── _parking-lot.md              # Cross-project idea capture
├── project-name/
│   ├── _index.md                # Changelog and decision log
│   ├── project-name-v1.md       # Version 1
│   ├── project-name-v2.md       # Version 2
│   └── ...
\`\`\`

### Project Document Structure

Use \`assets/templates/project-template.md\` for new projects. Key sections:

- **Quick Context** — 2-3 sentences: what is this, current state
- **Session Log** — Date, duration, energy level, mode, methods used
- **Open Questions** — Unresolved items needing thought
- **Current Thinking** — The substance of where things stand
- **Ideas Inventory** — Organized by maturity level (Raw → Developing → Refined
  → Ready → Parked → Eliminated)
- **Decisions Made** — Logged with reasoning
- **Next Steps** — Clear actionable items

### Index File Structure

Use \`assets/templates/index-template.md\`. Tracks:

- Version history with dates and summaries
- Major decisions across all versions
- Project status and trajectory

## Idea Maturity Levels

Track where each idea sits:

| Level      | Meaning                              |
| ---------- | ------------------------------------ |
| Raw        | Just captured, unexamined            |
| Developing | Being explored, has potential        |
| Refined    | Shaped, tested, ready for evaluation |
| Ready      | Decision made, ready to execute      |
| Parked     | Not now, but worth keeping           |
| Eliminated | Killed, with documented reasoning    |

## Quick Capture Mode

For rapid idea capture when time is short:

1. User dumps raw idea
2. Ask 2-3 clarifying questions only
3. Create minimal v1 document
4. Note: "Quick capture—expand in future session"

## Disagreement Protocol

When pushing back and the user disagrees:

1. Make your case clearly
2. Listen to their reasoning
3. User decides
4. Log the disagreement and resolution with both perspectives

## Synthesis Prompts

After 3+ sessions on a project, offer:

- "We've had [N] sessions on this. Want me to create a synthesis document that
  distills our current best thinking?"

## Success Criteria

Early in any project, establish:

- "What does 'done' look like for this brainstorm?"
- "How will we know we've succeeded?"

## Method Selection Guide

See \`references/methods-quick.md\` for quick selection. See
\`references/methods-detailed.md\` for full explanations to share with user.

**General guidance:**

- **Stuck/need new angles** → Divergent methods (SCAMPER, Random Stimulus,
  Forced Analogies)
- **Too many ideas/need focus** → Convergent methods (Affinity Grouping,
  Elimination Rounds)
- **Unclear problem** → Problem-framing methods (First Principles, 5 Whys,
  Inversion)
- **Echo chamber risk** → Perspective shifts (Six Thinking Hats, Steelman,
  Audience Reality Check)
- **Before committing** → Pre-mortem, Assumption Surfacing
- **Theological/philosophical depth** → Presuppositional Analysis

## Key Reminders

- Always get explicit approval before changing direction or applying a method
- The human's call always wins, but capture the reasoning
- Version files, don't overwrite
- Surface connections in connected mode; stay focused in clean-slate mode
- End every session with a clear exit summary and next version document
`

const METHODS_QUICK = `# Brainstorming Methods - Quick Reference

Quick selection guide. For full explanations, see \`methods-detailed.md\`.

## Divergent Methods (Generate New Ideas)

| Method                  | Best For                    | One-liner                                                                                     |
| ----------------------- | --------------------------- | --------------------------------------------------------------------------------------------- |
| **SCAMPER**             | Improving existing concepts | Systematic prompts: Substitute, Combine, Adapt, Modify, Put to other uses, Eliminate, Reverse |
| **Random Stimulus**     | Breaking mental ruts        | Introduce unrelated word/image, force connections                                             |
| **Forced Analogies**    | Fresh perspectives          | "How would [X industry/person] solve this?"                                                   |
| **Mind Mapping**        | Exploring idea space        | Visual branching from central concept                                                         |
| **Worst Possible Idea** | Loosening constraints       | Generate terrible ideas, then invert                                                          |
| **TRIZ Principles**     | Technical/product problems  | 40 inventive principles for contradiction resolution                                          |

## Convergent Methods (Focus & Decide)

| Method                 | Best For              | One-liner                                |
| ---------------------- | --------------------- | ---------------------------------------- |
| **Affinity Grouping**  | Organizing many ideas | Cluster similar ideas, name the clusters |
| **Dot Voting**         | Quick prioritization  | Allocate limited votes across options    |
| **Weighted Scoring**   | Complex decisions     | Score options against weighted criteria  |
| **Elimination Rounds** | Narrowing options     | Progressive cuts with explicit criteria  |
| **2x2 Matrix**         | Comparing tradeoffs   | Plot options on two key dimensions       |

## Problem-Framing Methods

| Method                | Best For               | One-liner                                  |
| --------------------- | ---------------------- | ------------------------------------------ |
| **First Principles**  | Fundamental rethinking | Strip to basics, rebuild from ground truth |
| **5 Whys**            | Root cause analysis    | Ask "why" repeatedly to find core issue    |
| **Inversion**         | Finding hidden risks   | "What guarantees failure?" then avoid it   |
| **Problem Reframing** | Stuck on wrong problem | Restate the problem 5 different ways       |
| **Jobs-to-be-Done**   | Product/service design | What job is the user hiring this to do?    |

## Perspective Shift Methods

| Method                     | Best For                   | One-liner                                                            |
| -------------------------- | -------------------------- | -------------------------------------------------------------------- |
| **Six Thinking Hats**      | Structured group analysis  | Rotate through facts, feelings, risks, benefits, creativity, process |
| **Steelman**               | Testing ideas rigorously   | Build the strongest case for the opposing view                       |
| **Audience Reality Check** | Product/content validation | Would [specific person] actually want this?                          |
| **Stakeholder Mapping**    | Complex decisions          | Who cares, what do they want, what's their power?                    |
| **Time Horizons**          | Strategic thinking         | How does this look in 1 week / 1 year / 10 years?                    |

## Evaluation & Risk Methods

| Method                   | Best For             | One-liner                                                    |
| ------------------------ | -------------------- | ------------------------------------------------------------ |
| **Pre-mortem**           | Before committing    | Assume it failed—why?                                        |
| **Assumption Surfacing** | Foundational clarity | What are we taking for granted?                              |
| **10/10/10**             | Decision clarity     | How will I feel about this in 10 min / 10 months / 10 years? |
| **Reversibility Test**   | Risk assessment      | Is this a one-way or two-way door?                           |

## Theological/Philosophical Methods

| Method                        | Best For           | One-liner                                                |
| ----------------------------- | ------------------ | -------------------------------------------------------- |
| **Presuppositional Analysis** | Deep foundations   | What worldview assumptions underlie this idea?           |
| **Telos Examination**         | Purpose clarity    | What is the ultimate end/purpose this serves?            |
| **Stewardship Frame**         | Resource decisions | Am I being a faithful steward of what's entrusted to me? |

## Quick Selection Heuristics

- **"I have no ideas"** → Random Stimulus, Worst Possible Idea
- **"I have too many ideas"** → Affinity Grouping, Elimination Rounds
- **"I'm not sure what the real problem is"** → 5 Whys, Problem Reframing
- **"This feels risky"** → Pre-mortem, Inversion
- **"Am I missing something?"** → Six Thinking Hats, Steelman
- **"Is this actually valuable?"** → Jobs-to-be-Done, Audience Reality Check
- **"What are we assuming?"** → First Principles, Assumption Surfacing,
  Presuppositional Analysis
`

const METHODS_DETAILED = `# Brainstorming Methods - Detailed Guide

A comprehensive reference for understanding and applying brainstorming methods.
Use this when you want to understand a method before applying it, or when
exploring which approach fits your situation.

---

## Divergent Methods

These methods help generate new ideas, break out of mental ruts, and expand the
possibility space.

### SCAMPER

**What it is:** A systematic checklist of prompts that force you to look at an
existing concept from seven different angles.

**The prompts:**

- **S**ubstitute — What components, materials, or people could you swap out?
- **C**ombine — What could you merge with something else?
- **A**dapt — What could you borrow from another domain or context?
- **M**odify — What could you magnify, minimize, or alter?
- **P**ut to other uses — What else could this be used for?
- **E**liminate — What could you remove entirely?
- **R**everse/Rearrange — What if you flipped the order or orientation?

**When to use:** You have an existing idea, product, or concept and want to
systematically explore variations.

**How to apply:**

1. Clearly state the current concept
2. Work through each letter, spending 2-3 minutes generating options
3. Don't judge during generation—capture everything
4. Review and identify the most promising variations

**Example:** Brainstorming improvements to a newsletter

- Substitute: What if it was audio instead of text? What if readers wrote it?
- Combine: Newsletter + community forum? Newsletter + course?
- Adapt: How do podcasters build audience? How do academic journals work?
- Modify: What if it was daily instead of weekly? 10x longer? 10x shorter?
- Put to other uses: Could the research become a book? A consulting framework?
- Eliminate: What if there were no links? No images? No consistent schedule?
- Reverse: What if readers pitched topics to you? What if you wrote about what
  NOT to do?

---

### Random Stimulus

**What it is:** Introducing an unrelated word, image, or concept and forcing
yourself to find connections to your problem.

**When to use:** You're stuck in a mental rut, all ideas feel similar, or you
need genuinely novel thinking.

**How to apply:**

1. State your problem clearly
2. Generate a random stimulus (random word generator, open a book to random
   page, use a random image)
3. List attributes, associations, and characteristics of that stimulus
4. Force connections: "How might [attribute] apply to my problem?"
5. Develop any promising connections into actual ideas

**Example:** Problem: "How to make MVPKit stand out"

- Random word: "Lighthouse"
- Associations: guidance, warning, coastal, beam of light, solitary, automated,
  historic
- Forced connections:
  - "Guidance" → What if MVPKit included decision frameworks, not just code?
  - "Warning" → What if it flagged common MVP mistakes as you build?
  - "Beam of light" → What if it highlighted the ONE thing to focus on next?
  - "Automated" → What if the kit self-configured based on your answers?

---

### Forced Analogies

**What it is:** Deliberately applying thinking from a different domain,
industry, or persona to your problem.

**When to use:** You want fresh perspectives or suspect your industry has blind
spots.

**How to apply:**

1. State your problem
2. Choose an unrelated domain (another industry, a historical period, a
   fictional universe, a specific person)
3. Ask: "How would they approach this?" or "How does this work in that domain?"
4. Extract principles and apply them to your context

**Common analogy sources:**

- Industries: How would a restaurant/hospital/airline handle this?
- People: How would Bezos/your grandmother/a 5-year-old see this?
- Nature: How do ecosystems/ant colonies/immune systems solve this?
- History: How did pre-digital/medieval/ancient societies handle similar
  challenges?

**Example:** Problem: "How to build community around a technical product"

- Analogy: "How do churches build community?"
- Observations: Shared rituals, regular gatherings, mentorship structures,
  shared mission, service opportunities, small groups within larger body
- Applied: Weekly office hours (ritual), mentorship pairing for new users, clear
  mission statement, contribution pathways, cohort-based onboarding

---

### Worst Possible Idea

**What it is:** Deliberately generating terrible, absurd, or counterproductive
ideas, then examining what makes them bad and inverting.

**When to use:** The group is self-censoring, ideas feel too "safe," or you need
to loosen up.

**How to apply:**

1. State the challenge
2. Ask: "What's the worst possible way to handle this?"
3. Generate genuinely bad ideas (not just mediocre—actively terrible)
4. For each bad idea, identify WHY it's bad
5. Invert: What's the opposite? What principle does this reveal?

**Example:** Challenge: "Improve customer onboarding"

- Worst ideas:
  - Require 47-step registration
  - Send 20 emails on day one
  - Hide all documentation
  - Make them figure out pricing after they've built something
- Inversions:
  - Minimize required steps—what's the absolute minimum?
  - One well-timed email is better than many
  - Documentation should be discoverable in context
  - Pricing clarity before commitment builds trust

---

## Convergent Methods

These methods help organize, prioritize, and narrow down options.

### Affinity Grouping

**What it is:** Organizing ideas into clusters based on natural relationships,
then naming those clusters.

**When to use:** You have many ideas and need to see patterns and themes.

**How to apply:**

1. List all ideas (on cards, sticky notes, or a list)
2. Look for ideas that "belong together"—don't force categories yet
3. Group similar ideas together
4. Name each cluster with a descriptive label
5. Look for clusters that are dense (lots of energy there) vs. sparse
6. Identify gaps: What categories are missing?

**Tip:** Let groups emerge naturally rather than pre-defining categories. The
naming often reveals insight.

---

### Weighted Scoring

**What it is:** Evaluating options against explicit criteria with assigned
weights.

**When to use:** Complex decisions where multiple factors matter and you need to
make tradeoffs explicit.

**How to apply:**

1. Define criteria (3-7 factors that matter)
2. Assign weights to each criterion (must sum to 100%)
3. Score each option on each criterion (e.g., 1-5 scale)
4. Calculate weighted scores
5. Use scores as input, not final answer—discuss surprises

**Example criteria for evaluating product ideas:**

- Market size (20%)
- Technical feasibility (15%)
- Competitive differentiation (20%)
- Alignment with skills/interests (15%)
- Revenue potential (15%)
- Time to MVP (15%)

**Warning:** The value is in the conversation about weights and scores, not the
final number. If the "winner" feels wrong, examine why.

---

### 2x2 Matrix

**What it is:** Plotting options on two dimensions to reveal clusters and
tradeoffs.

**When to use:** You need to compare options and want to make tradeoffs visual.

**How to apply:**

1. Choose two important dimensions (often tension exists between them)
2. Draw the matrix with dimensions as axes
3. Plot each option in the appropriate quadrant
4. Discuss what each quadrant represents
5. Look for options in the desirable quadrant; discuss whether others can be
  moved

**Classic dimensions:**

- Impact vs. Effort
- Urgent vs. Important
- Feasibility vs. Desirability
- Risk vs. Reward
- Short-term vs. Long-term value

---

## Problem-Framing Methods

These methods help ensure you're solving the right problem.

### First Principles Thinking

**What it is:** Breaking down a problem to its fundamental truths and rebuilding
from there, rather than reasoning by analogy or convention.

**When to use:** Conventional approaches aren't working, or you suspect you're
trapped by inherited assumptions.

**How to apply:**

1. State the problem or goal
2. Ask: "What do we know to be absolutely true here?" (not assumed, not
  conventional—proven)
3. List only foundational facts
4. Rebuild: "Given only these truths, what options exist?"
5. Compare to conventional thinking—where do they diverge?

**Example:** "How should I price my course?"

- Conventional: "Look at competitor pricing and position accordingly"
- First principles:
  - What do I know? The course costs me X hours to create. Students get Y
    outcome. Market has Z alternatives.
  - What's actually true about pricing? Price = perceived value. Value = outcome
    achieved + experience + certainty.
  - Rebuild: What would I charge if competitors didn't exist? What outcome am I
    actually selling?

---

### 5 Whys

**What it is:** Repeatedly asking "why" to drill past symptoms to root causes.

**When to use:** You're treating symptoms rather than causes, or the real
problem isn't clear.

**How to apply:**

1. State the problem
2. Ask "Why does this happen?" or "Why is this a problem?"
3. Take the answer and ask "Why?" again
4. Repeat until you reach a root cause (usually 3-7 iterations)
5. Verify: Would solving this root cause address the original symptom?

**Example:**

- Problem: "I'm not making progress on my book"
- Why? "I never have time to write"
- Why? "Other tasks keep taking priority"
- Why? "Writing feels less urgent than client work"
- Why? "Client work has deadlines and the book doesn't"
- Why? "I haven't committed to a deadline or accountability structure"
- Root cause: Missing commitment structure, not missing time

---

### Inversion

**What it is:** Instead of asking how to succeed, asking how to guarantee
failure—then avoiding those things.

**When to use:** You're stuck on the positive framing, you want to identify
risks, or you need to challenge assumptions.

**How to apply:**

1. State your goal
2. Ask: "How could I guarantee failure at this?"
3. Generate ways to fail (be specific and comprehensive)
4. Invert each one: What's the opposite?
5. Check: Are you currently doing any of the failure-guarantee actions?

**Example:** Goal: "Launch a successful newsletter"

- Guaranteed failures:
  - Write about whatever I feel like with no focus
  - Publish inconsistently
  - Never promote it
  - Ignore reader feedback
  - Make it indistinguishable from existing newsletters
- Inversions:
  - Clear, specific focus
  - Consistent schedule
  - Active promotion strategy
  - Reader feedback loops
  - Distinctive angle/voice

---

### Jobs-to-be-Done

**What it is:** Understanding what "job" the customer is "hiring" your product
to do—focusing on the outcome they want rather than the product itself.

**When to use:** Product or service ideation, understanding customer motivation,
competitive analysis.

**How to apply:**

1. Ask: "What is the customer trying to accomplish?" (the job)
2. Ask: "What's the situation or trigger that creates this need?"
3. Ask: "What does success look like for them?"
4. Ask: "What are they currently hiring to do this job?" (competitors,
  workarounds, doing nothing)
5. Ask: "What's frustrating about current solutions?"

**JTBD statement format:** "When [situation], I want to [motivation], so I can
[outcome]."

**Example:** Analyzing MVPKit

- Job: "When I have a validated idea and limited time, I want to ship a working
  product fast, so I can start getting real user feedback before I burn through
  my runway."
- Current hires: Building from scratch, other boilerplates, no-code tools,
  hiring contractors
- Frustrations: Boilerplates are bloated, no-code limits customization, scratch
  takes too long

---

## Perspective Shift Methods

These methods help you see the problem from different angles.

### Six Thinking Hats

**What it is:** A structured way to examine a topic from six distinct
perspectives, one at a time.

**The hats:**

- **White Hat** — Facts and information. What do we know? What don't we know?
- **Red Hat** — Feelings and intuition. What's your gut reaction? (No
  justification required)
- **Black Hat** — Caution and risks. What could go wrong? What are the
  weaknesses?
- **Yellow Hat** — Benefits and value. What's good about this? Why might it
  work?
- **Green Hat** — Creativity and alternatives. What else is possible? New ideas?
- **Blue Hat** — Process and meta. What hat should we wear next? Are we done?

**When to use:** Group discussions that go in circles, decisions where emotions
and logic are tangled, need for structured comprehensive analysis.

**How to apply:**

1. Define the topic
2. Everyone wears the same hat at the same time
3. Spend 3-5 minutes per hat
4. Blue hat manages the process
5. Capture output from each hat separately

---

### Steelman

**What it is:** Building the strongest possible case for a position you disagree
with or are skeptical of.

**When to use:** Before dismissing an option, testing your own ideas,
understanding opposition, avoiding echo chambers.

**How to apply:**

1. State the position you're skeptical of
2. Ask: "What would make a reasonable person believe this?"
3. Build the strongest case: best evidence, best arguments, best framing
4. Present it as if you believed it
5. Only after steelmanning, respond with your actual view

**Why it matters:** If you can't articulate why smart people disagree with you,
you don't understand your own position well enough.

---

### Pre-mortem

**What it is:** Imagining the project has failed and working backward to
identify what went wrong.

**When to use:** Before committing to a plan, when confidence is high (that's
when blind spots are biggest), for risk identification.

**How to apply:**

1. State the project/decision
2. Imagine: "It's [6 months/1 year] from now. This failed. Why?"
3. Each person writes down reasons for failure independently
4. Share and compile the list
5. Prioritize: Which failure modes are most likely and most severe?
6. Address: What can we do now to prevent these?

**Key insight:** It's psychologically easier to explain a failure that
"happened" than to imagine one that might happen.

---

### Assumption Surfacing

**What it is:** Explicitly identifying the assumptions underlying a plan or
belief.

**When to use:** Before major commitments, when something feels risky but
unclear why, for foundational clarity.

**How to apply:**

1. State the plan or belief
2. Ask: "For this to work, what must be true?"
3. List all assumptions (market, technical, resource, behavioral, timing)
4. For each: "How confident are we? What would change our mind?"
5. Identify the riskiest assumptions
6. Ask: "How can we test these before committing?"

**Types of assumptions to check:**

- Market: Do people want this? Will they pay?
- Technical: Can we build it? In this timeline?
- Resource: Do we have the time/money/skills?
- Behavioral: Will users actually do what we expect?
- Competitive: Will the landscape stay favorable?
- Timing: Is now the right moment?

---

## Theological/Philosophical Methods

These methods bring depth to foundational questions about purpose, assumptions,
and stewardship.

### Presuppositional Analysis

**What it is:** Examining the worldview assumptions that underlie an idea,
argument, or approach.

**When to use:** Deep strategic decisions, when something feels "off" but you
can't articulate why, understanding why reasonable people disagree, ensuring
alignment with values.

**How to apply:**

1. State the idea or approach
2. Ask: "What view of [human nature / knowledge / purpose / reality] does this
  assume?"
3. Make the presuppositions explicit
4. Ask: "Do I actually hold these presuppositions?"
5. If not: "What would this look like built on my actual foundations?"

**Key presupposition categories:**

- Anthropology: What does this assume about human nature? Capability?
  Motivation?
- Epistemology: What does this assume about how we know things?
- Ethics: What does this assume about right/wrong, good/bad?
- Teleology: What ultimate purpose does this assume?

**Example:** Analyzing a productivity system

- Surface claim: "Optimize your time to maximize output"
- Presuppositions: Time is a resource to be maximized. Output = value.
  Efficiency is a primary good.
- Questions: Is productivity the telos? What about rest, relationships,
  formation? Does this assume I own my time, or that I'm a steward of it?

---

### Telos Examination

**What it is:** Asking what ultimate end or purpose something serves.

**When to use:** Strategic decisions, evaluating whether efforts are
well-directed, connecting work to meaning.

**How to apply:**

1. State the activity, project, or decision
2. Ask: "What is this ultimately for?"
3. If the answer is instrumental (a means to something else), ask again: "And
  what is THAT for?"
4. Continue until you reach a terminal value (something good in itself)
5. Evaluate: Is that terminal value actually good? Is this the best path to it?

**Example:** "Why am I building this SaaS?"

- To generate revenue → To have financial freedom → To have time for what
  matters → To invest in family, church, meaningful work → To live faithfully
  before God
- Evaluation: Does this SaaS actually serve that telos? Are there better paths?

---

### Stewardship Frame

**What it is:** Evaluating decisions through the lens of faithful stewardship
rather than ownership.

**When to use:** Resource allocation, major decisions, evaluating opportunities.

**Core question:** "I've been entrusted with
[time/skills/resources/platform/opportunity]. What would faithful stewardship
look like?"

**Sub-questions:**

- Am I using this to serve or to hoard?
- Will this multiply what's been entrusted to me?
- Who else is affected by how I steward this?
- What would I want to say about this stewardship later?
- Am I being a faithful steward or an anxious owner?

---

## Combining Methods

Methods work well in combination. Common pairings:

**For product ideation:**

1. Jobs-to-be-Done (understand the need)
2. SCAMPER or Forced Analogies (generate options)
3. Weighted Scoring (evaluate options)
4. Pre-mortem (test the winner)

**For strategic decisions:**

1. First Principles (clear the ground)
2. Six Thinking Hats (comprehensive analysis)
3. Steelman (test your conclusion)
4. Assumption Surfacing (identify risks)

**For creative breakthroughs:**

1. Random Stimulus or Worst Possible Idea (break the rut)
2. Affinity Grouping (find patterns)
3. Presuppositional Analysis (check alignment)

**For "should I do this?" decisions:**

1. Telos Examination (why does this matter?)
2. Pre-mortem (what could go wrong?)
3. Stewardship Frame (is this faithful?)
4. Inversion (how would I guarantee failure?)
`

const SESSION_TYPES = `# Session Types Reference

Guide for identifying brainstorming context and recommending appropriate
methods.

## Session Type Detection

Listen for cues to identify the type of brainstorming session:

| Session Type              | Typical Triggers                                                |
| ------------------------- | --------------------------------------------------------------- |
| **Product/SaaS Ideation** | "app idea," "SaaS," "product," "build," "startup," "MVP"        |
| **Content Ideation**      | "newsletter," "article," "blog," "book," "chapter," "content"   |
| **Strategic Decision**    | "should I," "deciding between," "weighing options," "strategic" |
| **Problem Solving**       | "stuck on," "can't figure out," "how do I," "challenge"         |
| **Creative/Artistic**     | "story," "design," "creative," "artistic direction"             |
| **Business Model**        | "pricing," "revenue," "business model," "monetization"          |
| **Positioning/Marketing** | "differentiate," "positioning," "messaging," "audience"         |

## Recommended Methods by Session Type

### Product/SaaS Ideation

**Core questions to answer:**

- What problem does this solve?
- Who specifically has this problem?
- Why would they choose this over alternatives?
- Can I build it? Should I?

**Recommended methods:**

1. **Jobs-to-be-Done** — Understand the real need
2. **Audience Reality Check** — Validate the target user exists
3. **Competitive Analysis** — Map the landscape
4. **First Principles** — Challenge inherited assumptions
5. **Pre-mortem** — Identify failure modes before committing

**Watch out for:** Falling in love with the solution before validating the
problem.

---

### Content Ideation (Newsletter, Articles, Books)

**Core questions to answer:**

- What does my audience need to hear?
- What do I have unique insight on?
- What's the angle that makes this mine?
- How does this fit my larger body of work?

**Recommended methods:**

1. **Mind Mapping** — Explore the idea space
2. **Audience Reality Check** — Who specifically wants this?
3. **Forced Analogies** — Find fresh angles
4. **SCAMPER** — Vary existing ideas
5. **Telos Examination** — Why does this content matter?

**Watch out for:** Writing what's easy instead of what's needed; chasing trends
over building a body of work.

---

### Strategic Decision

**Core questions to answer:**

- What are my actual options?
- What matters most in this decision?
- What am I assuming?
- What's the risk profile?

**Recommended methods:**

1. **First Principles** — Clear away assumptions
2. **Weighted Scoring** — Make tradeoffs explicit
3. **Pre-mortem** — Test your leading option
4. **Steelman** — Argue for options you're dismissing
5. **10/10/10** — Check against time horizons

**Watch out for:** Deciding before actually exploring options; confirmation
bias.

---

### Problem Solving

**Core questions to answer:**

- What's the real problem? (Not the symptom)
- What have I tried?
- What assumptions am I making?
- What would make this easy?

**Recommended methods:**

1. **5 Whys** — Find the root cause
2. **Problem Reframing** — Restate the problem multiple ways
3. **Inversion** — What would guarantee failure?
4. **Forced Analogies** — How do other domains solve this?
5. **First Principles** — Strip to fundamentals

**Watch out for:** Solving the wrong problem; jumping to solutions too fast.

---

### Business Model / Monetization

**Core questions to answer:**

- Who pays? For what value?
- What's the pricing psychology?
- How does this scale?
- What's sustainable long-term?

**Recommended methods:**

1. **Jobs-to-be-Done** — What are they really buying?
2. **Forced Analogies** — How do similar businesses price?
3. **First Principles** — What is price really?
4. **Assumption Surfacing** — What must be true for this model to work?
5. **Stewardship Frame** — Is this pricing faithful/fair?

**Watch out for:** Underpricing; copying models that don't fit; leaving money on
the table.

---

### Positioning / Marketing

**Core questions to answer:**

- Who is this for? (specifically)
- What makes this different?
- What's the one thing to remember?
- Why should they believe me?

**Recommended methods:**

1. **Audience Reality Check** — Get specific about who
2. **Steelman** — Argue for competitors
3. **Inversion** — How would I make this forgettable?
4. **SCAMPER** — Vary the positioning
5. **Forced Analogies** — How do non-competitors position?

**Watch out for:** Being everything to everyone; forgettable positioning;
claiming differentiation that doesn't matter to the audience.

---

## Session Energy Modes

### Deep Exploration Mode

**Characteristics:** Long session, open-ended, divergent, willing to go down
rabbit holes.

**Approach:**

- Use divergent methods freely
- Allow tangents (but park off-topic items)
- Don't rush to converge
- Embrace ambiguity
- End with synthesis, not decisions

### Quick Progress Mode

**Characteristics:** Short session, focused, need to move forward, decisions
over exploration.

**Approach:**

- Start with clear scope: "What decision do we need to make today?"
- Use convergent methods primarily
- Time-box divergent exploration (10 min max)
- Make decisions and log them
- End with next actions

---

## Mode Selection: Connected vs. Clean-Slate

### Connected Mode (Default)

Cross-reference other projects and existing work. Surface connections like:

- "This relates to your thinking on X"
- "You explored something similar in [project]"
- "This might conflict with what you decided about Y"
- "This could feed into your newsletter/book/other project"

**Best for:** Building on existing work, ensuring consistency, leveraging past
thinking.

### Clean-Slate Mode

No references to other projects or prior work. Fresh perspective.

**Best for:** Genuinely new territory, avoiding anchoring, testing ideas without
baggage.

**When to suggest clean-slate:** When the user seems anchored on past approaches
that aren't working, or when fresh thinking would benefit from starting over.
`

const INDEX_TEMPLATE = `# [Project Name] — Index

**Created:** YYYY-MM-DD
**Last Updated:** YYYY-MM-DD
**Current Version:** vX
**Status:** [Raw Idea / Exploring / Converging / Ready to Execute / Paused /
Completed / Abandoned]

---

## Project Summary

[2-3 sentence description of what this brainstorming project is about]

---

## Version History

| Version | Date       | Focus                | Key Outcomes                   |
| ------- | ---------- | -------------------- | ------------------------------ |
| v1      | YYYY-MM-DD | [What we focused on] | [What we accomplished/decided] |
| v2      | YYYY-MM-DD | [What we focused on] | [What we accomplished/decided] |

---

## Major Decisions Log

Decisions that shaped the project direction:

| #   | Decision             | Date       | Version | Confidence   | Notes                  |
| --- | -------------------- | ---------- | ------- | ------------ | ---------------------- |
| 1   | [Decision statement] | YYYY-MM-DD | v1      | High/Med/Low | [Any relevant context] |
| 2   | [Decision statement] | YYYY-MM-DD | v2      | High/Med/Low | [Any relevant context] |

---

## Pivots & Direction Changes

[Document any major shifts in thinking and why they happened]

| Date       | From            | To              | Reason                     |
| ---------- | --------------- | --------------- | -------------------------- |
| YYYY-MM-DD | [Old direction] | [New direction] | [What prompted the change] |

---

## Key Insights

Insights worth preserving regardless of where the project goes:

1. [Insight 1]
2. [Insight 2]

---

## Parked Ideas

Ideas that didn't fit this project but might be valuable elsewhere:

- [Idea] → Might fit: [other project or context]

---

## Project Trajectory

**Where we started:** [Original problem/goal]

**Where we are:** [Current state]

**Where we're headed:** [Anticipated direction or outcome]

---

## Files in This Project

- \`_index.md\` — This file
- \`[project-name]-v1.md\` — [Brief description of v1 state]
- \`[project-name]-v2.md\` — [Brief description of v2 state]
`

const PROJECT_TEMPLATE = `# [Project Name]

## Quick Context

[2-3 sentences: What is this project? What problem are we solving? Current state
in one line.]

**Status:** [Raw Idea / Exploring / Converging / Ready to Execute / Paused]

**Success Criteria:** [What does "done" look like for this brainstorm?]

---

## Session Log

| Version | Date       | Duration | Energy     | Mode            | Methods Used | Summary            |
| ------- | ---------- | -------- | ---------- | --------------- | ------------ | ------------------ |
| v1      | YYYY-MM-DD | Xm       | Deep/Quick | Connected/Clean | [Methods]    | [One-line summary] |

---

## Open Questions

Questions that need thinking before next session:

1. [Question 1]
2. [Question 2]

**Overnight Question:** [The one question to sit with]

---

## Current Thinking

[The substance of where things stand. This section is the heart of the
document—capture the actual thinking, not just ideas listed.]

### Key Insights

[What have we learned or realized?]

### Core Tensions

[What tradeoffs or conflicts are we navigating?]

### Where We're Headed

[Current direction, if one is emerging]

---

## Ideas Inventory

### Raw

_Just captured, unexamined_

-

### Developing

_Being explored, has potential_

-

### Refined

_Shaped and tested, ready for evaluation_

-

### Ready

_Decision made, ready to execute_

-

### Parked

_Not now, but worth keeping_

-

### Eliminated

_Killed, with reasoning_

- [Idea]: Eliminated because [reason]

---

## Decisions Made

| Decision             | Date       | Reasoning             | Confidence      |
| -------------------- | ---------- | --------------------- | --------------- |
| [Decision statement] | YYYY-MM-DD | [Why we decided this] | High/Medium/Low |

---

## Disagreements & Resolutions

[When we disagreed, what were the perspectives, and how was it resolved?]

---

## Connections to Other Work

[How does this relate to other projects? Only in Connected Mode.]

---

## Next Steps

- [ ] [Specific actionable next step]
- [ ] [Another next step]

**Next session focus:** [What should we tackle next time?]
`

export function registerBrainstormSkill(): void {
  registerBundledSkill({
    name: 'brainstorm',
    description:
      'Collaborative brainstorming partner for multi-session ideation projects. Use when the user wants to brainstorm, ideate, explore ideas, or think through problems—whether for SaaS products, software tools, book ideas, newsletter content, business strategies, or any creative/analytical challenge. Handles session continuity across days/weeks via versioned markdown documents.',
    userInvocable: true,
    argumentHint: 'topic or context for the brainstorming session',
    files: {
      'references/methods-quick.md': METHODS_QUICK,
      'references/methods-detailed.md': METHODS_DETAILED,
      'references/session-types.md': SESSION_TYPES,
      'assets/templates/index-template.md': INDEX_TEMPLATE,
      'assets/templates/project-template.md': PROJECT_TEMPLATE,
    },
    async getPromptForCommand(args) {
      let prompt = BRAINSTORM_PROMPT
      if (args) {
        prompt += `\n\n## Current Session Topic\n\n${args}`
      }
      return [{ type: 'text', text: prompt }]
    },
  })
}
