# Demo script (target 3:30, hard limit 4:00)

Follow the recorded demo path exactly: Batch A (the default start, which replays the recorded window L-00081 to L-00100), one run, one receipt, one ruling. Only the numbers in the README results table are verified; do not claim more. Record at 1280 px wide.

| Time | On screen | Say |
| --- | --- | --- |
| 0:00 to 0:20 | Title card with two numbers: "48.74% of Medicare Advantage directory locations had a deficiency (CMS)" and "Senate secret shoppers booked an appointment only 18% of the time" | "When a patient looks up a mental-health provider, the directory is often wrong, or the provider is a ghost. Health plans have to find and fix that, field by field." |
| 0:20 to 0:50 | Architecture slide: Zetaris, gateway, agents, Nightshift, H-MEM | "Ghost Network Auditor reconciles four sources through Zetaris: the plan directory, the credentialing roster, claims activity and NPPES. Agents can only use approved query templates, and every query leaves a receipt." |
| 0:50 to 1:40 | UI: pick Batch A, press Start. Timeline fills; point at the model chips | "Each run plans, investigates, arbitrates, then a Critic checks the evidence. Every model call goes through Meterless Nightshift to NVIDIA Nemotron; the chip shows which model handled it and how long it took." |
| 1:40 to 2:20 | Open the Sunrise Behavioral Group evidence card, then click a receipt | "Pick a listing where claims disagree with the directory and roster and show the evidence card: each source, the winner, the Critic verdict and the receipt; replay shows the rows still match. If the change is escalated rather than applied, say so: low-confidence and high-impact changes go to the analyst." |
| 2:20 to 2:55 | Outreach queue: a ghost listing's card, then submit a ruling | "This provider is listed as accepting, has no claims in over a year, and is terminated in the roster. Ghost and not-accepting changes are never automatic. The analyst decides, and the ruling goes into H-MEM." |
| 2:55 to 3:25 | The results table from the README, or the cold vs warm report | "We scored this against a planted-error answer key. The agents found every planted error on the listings they examined, applied nothing wrong, and never auto-applied a ghost or not-accepting change. Memory cut contact escalations from 30 to 25, and the no-memory control wrongly applied 3 values where the memory run applied none. The analyst here is simulated, and we say so." |
| 3:25 to 3:50 | Sponsor slide: Zetaris, Meterless H-MEM + World Model + Nightshift, NVIDIA Nemotron, Cursor | "Zetaris is the data layer, H-MEM carries the lesson, Nightshift routes every model call, and Nemotron does the reasoning. All data is synthetic. The repo has a sample mode that runs with no keys." |

Tips
- Do the whole path once off camera first so nothing is waiting for the first Ultra call.
- Do not claim live Zetaris if you are showing replay mode. Say "recorded run" or show the live stack.
- Keep the terminal and any `.env` or token out of frame.
