#!/usr/bin/env python3
"""Generate a fictional demo vault for README screenshots.

Usage: python3 scripts/make-demo-vault.py [target-dir]

Everything here is invented: no personal data, no real vault content. Run the
app against the result (SECOND_BRAIN_VAULT=<target>) to capture screenshots.

Dates are anchored on today, because the vault is read through date-aware
widgets: a fixed calendar makes the demo look abandoned a fortnight later —
missed sessions, no brief, an execution rhythm flat at zero.
"""
import json
import os
import random
import shutil
import sys
from datetime import date, datetime, timedelta

ROOT = sys.argv[1] if len(sys.argv) > 1 else "/tmp/demo-vault"
TODAY = date.today()
NOW = f"{TODAY.isoformat()}T07:12:00.000Z"
HERE = os.path.dirname(os.path.abspath(__file__))
random.seed(20260817)

FOLDERS = [
    "00-System", "01-Inbox", "02-Raw", "03-Wiki", "04-Objectives", "05-Tasks",
    "06-Daily", "07-Weekly", "08-Projects/Trail-26K", "08-Projects/Training",
    "09-Skills", "10-Finance", "11-Custom/_registry", "12-Business", "_Archive",
]


def day(offset):
    return TODAY - timedelta(days=offset)


def iso(d, t="09:00:00"):
    return f"{d.isoformat()}T{t}.000Z"


def week_label(d):
    year, week, _ = d.isocalendar()
    return f"{year}-W{week:02d}"


def write(rel, front, body):
    path = os.path.join(ROOT, rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    lines = ["---"]
    for key, value in front.items():
        if isinstance(value, list):
            lines.append(f"{key}:")
            lines.extend(f"  - {item}" for item in value)
        elif isinstance(value, bool):
            lines.append(f"{key}: {'true' if value else 'false'}")
        elif isinstance(value, (int, float)):
            lines.append(f"{key}: {value}")
        else:
            lines.append(f'{key}: "{value}"' if " " in str(value) or ":" in str(value) else f"{key}: {value}")
    lines.append("---")
    with open(path, "w", encoding="utf-8") as handle:
        handle.write("\n".join(lines) + "\n" + body.strip() + "\n")


def write_json(rel, payload):
    path = os.path.join(ROOT, rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=2)


# ---------------------------------------------------------------- scaffolding
if os.path.isdir(ROOT):
    shutil.rmtree(ROOT)
for folder in FOLDERS:
    os.makedirs(os.path.join(ROOT, folder), exist_ok=True)
with open(os.path.join(ROOT, ".second-brain-initialized"), "w") as handle:
    handle.write(NOW)

write_json(".second-brain-setup.json", {
    "version": 1,
    "status": "completed",
    "currentStep": "review",
    "locale": "en",
    "theme": "dark",
    "timezone": "Europe/Paris",
    "currency": "EUR",
    "context": {
        "identity": "Solo founder of Kairn AI, a support-automation SaaS",
        "focusAreas": "Product, founder-led sales, ultra-distance training",
        "weeklyRhythm": "Product in the mornings, sales in the afternoons, review on Friday",
        "contactEmail": "founder@example.com",
        "operatingRules": [
            "Three important outcomes per week, no more",
            "No feature without an interview, a metric or a customer incident",
        ],
        "currentPriorities": [
            "Reach 10,000 EUR MRR",
            "Reach 95% accepted support answers",
            "Finish UTMB",
        ],
    },
    "modules": {"finance": True, "budget": True, "trail": True, "business": True,
                "revisions": False, "custom": []},
    "feeds": {"enabled": True, "urls": ["https://news.ycombinator.com/rss"]},
    "ai": {"primary": "claude", "fallback": "codex", "verified": ["claude", "codex"],
           "models": {"claude": "claude-fable-5", "codex": "gpt-5-codex"}},
    "automation": {"briefFrequency": "daily", "briefTime": "07:00", "briefDetail": "balanced"},
    "goals": [],
})

# ------------------------------------------------------------------- context
write("00-System/Context.md", {
    "type": "system", "role": "identity", "title": "System Context",
    "created": iso(day(120)), "updated": NOW, "setup_completed_at": iso(day(120)),
}, """
# System Context

## Identity

Solo founder of Kairn AI, a B2B SaaS that helps support teams run controllable
AI agents on their own documentation. Entirely fictional.

## Situation

- Solo for six months, with a freelance developer two days a week.
- Nine pilot customers, 6,350 EUR MRR, 11,200 EUR in the company account.
- Turning pilots into annual contracts before raising anything.
- Outside work: ultra-distance trail, technical reading, close friends.

## Operating rules

- Three important outcomes per week, no more.
- No feature without an interview, a metric or a customer incident attached.
- Mornings belong to the product, afternoons to sales.
- Every reversible decision gets made quickly and written down.

## Constraints

- Thirteen months of personal runway.
- No permanent hire before 10,000 EUR MRR.
- One evening and one full day off every week.
""")

# ---------------------------------------------------------------- objectives
MRR = "Reach 10,000 EUR MRR"
QUALITY = "Reach 95% accepted support answers"
RACE = "Finish UTMB under 40 hours"

objectives = [
    ("reach-10000-mrr", MRR, "Kairn AI", "high", "2026-09-30", 100,
     "Go from 6,350 EUR to 10,000 EUR MRR before September 30, without hiring.\n\n"
     "## Success criteria\n- Convert five pilots into annual contracts.\n"
     "- Keep logo churn at zero for the quarter.\n- Hold gross margin above 78%."),
    ("accepted-support-answers", QUALITY, "Product", "high", "Q3 2026", 200,
     "Measure quality over 500 real conversations and keep every answer traceable\n"
     "back to its source.\n\n## Success criteria\n- No critical error across the eval set.\n"
     "- Every answer cites a document inside its freshness window.\n"
     "- Acceptance measured on the covered scope, not on every ticket."),
    ("finish-utmb", RACE, "Health", "medium", "2026-08-30", 300,
     "Cover the 171 km and 10,000 m of vertical gain around Mont Blanc on August 30,\n"
     "inside the 46h30 cut-off and without dropping at an aid station.\n\n"
     "## Success criteria\n- Reach Courmayeur under 15 hours with legs to carry on.\n"
     "- Sleep less than thirty minutes in total on the second night.\n"
     "- Hold the fuelling protocol proven on the 35 km run: 70 g of carbs per hour."),
]
for slug, title, area, priority, horizon, order, body in objectives:
    write(f"04-Objectives/{slug}.md", {
        "type": "objective", "title": title, "status": "active", "area": area,
        "priority": priority, "horizon": horizon, "created": iso(day(126)),
        "updated": NOW, "order": order, "tags": [area.lower().replace(" ", "-")],
    }, f"# {title}\n\n{body}")

# --------------------------------------------------------------------- tasks
# (title, status, priority, area, objective, done_offset, body)
tasks = [
    ("Ship the freshness check to production", "done", "high", "Product", QUALITY, 0,
     "Past thirty days, the answer offers a human handover instead of quoting a\nstale policy."),
    ("Send the annual proposal to Northstar", "done", "high", "Sales", MRR, 1,
     "Annual Team plan, 18,000 EUR, with the ninety-day exit clause their finance\nteam asked for."),
    ("Re-run the eval set after the fix", "done", "high", "AI", QUALITY, 2,
     "93.4% acceptance against 91.6% before the passage split. The twenty-seven\nfailures drop to eleven."),
    ("Write the SignalOps case study", "done", "medium", "Kairn AI", MRR, 3,
     "Numbers signed off by their support lead: 41% of tickets resolved without a\nhuman, 0.084 EUR per resolution."),
    ("Split long policies into passages", "done", "high", "Product", QUALITY, 4,
     "One passage per rule, section heading kept as metadata, so the citation lands\non the right paragraph."),
    ("Confirm the UTMB entry and lodging", "done", "medium", "Health", RACE, 5,
     "Lottery place confirmed, medical certificate filed, flat booked in Chamonix\nfor the whole race week."),
    ("Invoice the August licences", "done", "medium", "Business", MRR, 6,
     "Four invoices issued, two paid the same day by transfer."),
    ("Schedule the week's sessions", "done", "low", "Health", RACE, 6,
     "Six blocks in the calendar, long run moved to Sunday morning to dodge the heat."),
    ("Scout the Chamonix to Les Contamines section", "done", "medium", "Health", RACE, 7,
     "First thirty-one kilometres covered at night, at race pace: the Col de Voza\nclimb stays in zone 2 without forcing."),
    ("Clean up the sales pipeline", "done", "low", "Sales", MRR, 9,
     "Two dormant opportunities archived, three follow-ups scheduled, weighted\namounts brought back up to date."),
    ("Write the agent evaluation sheet", "done", "medium", "AI", QUALITY, 10,
     "Four scores per answer: decision, source, account rules, acceptability with no\nedits."),
    ("Chase the three silent pilots", "done", "medium", "Sales", MRR, 11,
     "Two replies within twenty-four hours, one of them asking for a board demo."),
    ("Finish the Enterprise page", "done", "high", "Kairn AI", MRR, 13,
     "Security evidence, the ROI calculation and the three case studies."),
    ("Draft the eval protocol v2", "doing", "high", "AI", QUALITY, None,
     "Move from 200 to 500 real conversations, with a second human judgement on the\ndisputed sample."),
    ("Prepare the LumenPay security review", "doing", "high", "Sales", MRR, None,
     "Sixty-line questionnaire, audit log and retention policy to document before\nthe 24th."),
    ("Prepare the Northstar board demo", "doing", "high", "Sales", MRR, None,
     "Start from a real ticket, show the source, the supervision, then the quality\nreport."),
    ("Analyse the 27 failures from the last eval set", "todo", "medium", "AI", QUALITY, None,
     "Sort the errors into retrieval, instruction, contradictory source and wrong\nrefusal."),
    ("Fix answers without a recent source", "todo", "high", "Product", QUALITY, None,
     "Block generation when the documentation is past its allowed freshness window."),
    ("Scout the descent into Courmayeur", "todo", "medium", "Health", RACE, None,
     "A thousand metres of descending at kilometre 80, on legs that are already\ncooked. In daylight this time."),
    ("Propose the annual plan to HelioDesk", "todo", "medium", "Sales", MRR, None,
     "Re-run the return-on-investment case on their real volumes before sending the\nquote."),
    ("Book the refuge for the weekend of the 22nd", "todo", "low", "Personal", None, None,
     "Confirm with Jules and Ines before Thursday evening."),
]
for idx, (title, status, priority, area, objective, done_offset, body) in enumerate(tasks):
    slug = title.lower().replace(" ", "-")
    for ch in ",.'’":
        slug = slug.replace(ch, "")
    created = day(min(20, (done_offset if done_offset is not None else 3) + 4))
    front = {
        "type": "task", "title": title, "status": status, "priority": priority,
        "area": area, "source": "agent",
        "created": iso(created), "updated": NOW,
        "order": 100 * (idx + 1), "tags": [area.lower().replace(" ", "-")],
    }
    if objective:
        front["objective"] = objective
    if done_offset is not None:
        front["done_on"] = iso(day(done_offset), "17:20:00")
    write(f"05-Tasks/{created.strftime('%Y%m%d')}-{idx:02d}-{slug}.md", front, f"# {title}\n\n{body}")

# ------------------------------------------------------------------ captures
captures = [
    ("measuring-document-freshness-in-a-rag-pipeline", "https://example.com/rag-freshness", "inbox",
     "Add the source age and the last index date to the diagnosis. A good answer\nbuilt on a stale policy is still a bad answer."),
    ("pricing-ai-agents-per-resolution", "https://example.com/pricing-ai-agents", "inbox",
     "Charging per attempt makes the customer pay for the product's own failures;\ncharging per verified resolution aligns both sides."),
    ("what-support-teams-actually-escalate", "https://example.com/support-operations", "inbox",
     "Escalations cluster around account-specific rules, not around language\nunderstanding."),
    ("keeping-a-decision-journal", "https://example.com/decision-journal", "inbox",
     "Write the expected outcome before the decision, not the justification after\nit."),
    ("open-source-as-a-distribution-channel", "https://example.com/open-source-distribution", "inbox",
     "A readable repository converts better than a landing page for technical\nbuyers, provided the demo runs in one command."),
    ("endurance-load-and-decision-quality", "https://example.com/founder-endurance", "inbox",
     "Sleep and easy sessions are not rewards for finished work. They hold decision\nquality up when commercial pressure rises."),
    ("design-systems-for-single-maintainer-products", "https://example.com/design-system", "processed",
     "One maintainer cannot hold a component library and a product at once; tokens\nplus a handful of primitives is the sustainable ceiling."),
]
for idx, (slug, url, status, body) in enumerate(captures):
    title = slug.replace("-", " ").capitalize()
    front = {
        "type": "capture", "title": title, "status": status, "source": "rss",
        "url": url, "feed": "https://news.ycombinator.com/rss",
        "captured_at": iso(day(idx), "05:30:00"), "created": iso(day(idx), "05:30:00"),
        "updated": NOW, "tags": ["rss"],
    }
    if status == "processed":
        front["processed_at"] = NOW
    write(f"01-Inbox/{day(idx).strftime('%Y%m%d')}-0530{idx}0-{slug}.md", front,
          f"# {title}\n\n[Source]({url})\n\n{body}")

# ---------------------------------------------------------------- wiki notes
wiki = [
    ("controlling-document-freshness", "Controlling document freshness", "Product",
     "An accurate answer built on an expired policy is still a wrong answer.\nFreshness belongs in the generation contract, not on an observability chart.",
     "Past its declared validity, generation stops and hands over to a human, with\na link to the document that needs updating.",
     "Should the freshness threshold be global, or declared document by document by\nits owner?",
     "Ship the blocking rule, then re-run the eval set on the same 500 conversations."),
    ("splitting-a-knowledge-base-into-passages", "Splitting a knowledge base into passages", "Product",
     "Fixed-size chunking cuts long policies in the middle of a rule: the retrieved\npassage holds the condition but not the exception that contradicts it.",
     "One passage equals one applicable rule, with its section path kept as\nmetadata and its exceptions attached.",
     "Re-index everything at once, or only the documents cited in known failures?",
     "Re-index the twelve policies that appear in the current eval failures."),
    ("evaluating-a-support-agent", "Evaluating a support agent", "Product",
     "Four scores per answer: decision accuracy, a genuinely relevant source,\naccount rules respected, and acceptability with no human edit.",
     "Keep the imperfect phrasings, the contradictions between documents and the\nrequests that must be refused.",
     "How honest is an acceptance rate measured on 200 conversations once volume\ndoubles?",
     "Move the protocol to 500 conversations with a second human judgement."),
    ("usage-pricing-without-punishing-adoption", "Usage pricing without punishing adoption", "Business",
     "Billing per conversation turns every internal rollout into a budget argument,\nand the support team ends up rationing the tool it just bought.",
     "Charge the verified resolution: accepted by a human, or closed without a\nreopen within seven days.",
     "Where does the contractual monthly cap sit so an incident never produces a\nsurprise invoice?",
     "Add a cap to the two annual proposals currently open."),
    ("kairn-ai-pricing-principles", "Kairn AI pricing principles", "Business",
     "Price combines a fixed platform fee with an included volume of verified\nresolutions.",
     "Pilot at 750 EUR a month for one channel, Team at 1,500 EUR for three.",
     "Which plan do the pilots actually convert on when the annual discount is\nremoved?",
     "Test the annual plan with HelioDesk on their real volumes."),
    ("founder-led-sales-for-an-ai-product", "Founder-led sales for an AI product", "Growth",
     "The demo has to follow a ticket from the customer's own queue, show the chosen\nsource, expose a limit, then fix the system live.",
     "A limit shown on purpose builds more trust than a flawless scripted run.",
     "Which risk stops this team from automating today?",
     "Rebuild the Northstar demo around three of their own logistics tickets."),
    ("the-founders-weekly-review", "The founder's weekly review", "Organisation",
     "The review produces four outputs: reliable numbers, decisions taken, open\nrisks, and the three outcomes expected next week.",
     "Minimum table: MRR, active pilots, acceptance rate, cloud spend.",
     "Which number was reported without being measured this week?",
     "Keep Friday afternoon free for the review, before the week fills it."),
]
for idx, (slug, title, area, summary, insight, question, action) in enumerate(wiki):
    write(f"03-Wiki/{slug}.md", {
        "type": "wiki", "title": title, "status": "active", "area": area,
        "source": "inbox", "created": iso(day(idx + 4)), "updated": iso(day(idx)),
        "tags": ["processed-capture", area.lower()],
    }, f"""# {title}

## Summary
{summary}

## Insight
{insight}

## Open question
{question}

## Next action
{action}

## Links
- [[{QUALITY}]]
""")

# ------------------------------------------------------------- raw / journal
journal = [
    (1, "Long run of 34.8 km with 869 m of gain, no calf pain the next morning. Last\nbig volume before the taper."),
    (3, "Northstar asked for the ninety-day exit clause in writing. Their board meets\non the 21st."),
    (5, "Eleven failures left in the eval set, all outside the documented scope. That\nis a sales conversation, not a product fix."),
]
for offset, body in journal:
    d = day(offset)
    write(f"02-Raw/{d.isoformat()}-journal.md", {
        "type": "note", "title": f"Journal {d.isoformat()}", "status": "active",
        "created": iso(d, "21:00:00"), "updated": iso(d, "21:00:00"), "tags": ["journal"],
    }, f"# Journal {d.isoformat()}\n\n{body}")

# --------------------------------------------------------------- daily briefs
briefs = [
    (0, "The freshness check went to production this morning: past thirty days, the\n"
        "answer offers a human handover instead of quoting an expired policy.\n"
        "Northstar acknowledged the annual proposal.",
     "Two files need the same thing this week — the LumenPay security review and\n"
     "the eval protocol v2 — and both run through you alone. One of them will\n"
     "slip: better to pick which one now.",
     ["**Prepare the LumenPay security review** — the only blocking item before the 24th.",
      "**Draft the eval protocol v2**, accepting that it waits for the security review."],
     "Is the HelioDesk annual plan decided on price, or on the guarantee that their\ndata can be taken back out?"),
    (1, "Week 18 closed in full: six blocks out of six, long run of 34.8 km with 869 m\n"
        "of gain and no calf pain the next day. Last big volume before the taper.",
     "The volume peak and the busiest sales week of the quarter land together. The\n"
     "plan holds as long as sessions stay in the morning; moved to the evening,\n"
     "they are the ones that get dropped.",
     ["**Scout the descent into Courmayeur**, the only part of the course never run.",
      "**Send the annual proposal to Northstar** before Monday morning."],
     "The taper starts: halve the volume and keep the intensity, or cut everything\nand arrive fresh at the cost of sharpness?"),
    (2, "93.4% acceptance after the fix, against 91.6% before. The twenty-seven failures\n"
        "drop to eleven, all of them outside the documented scope: that is a framing\n"
        "problem in sales, not a retrieval problem.",
     "The objective is set at 95%. The eleven remaining failures cannot be fixed in\n"
     "the product; counting them as technical debt would mean working on the wrong\n"
     "thing for three weeks.",
     ["**Draft the eval protocol v2** to reach 500 conversations with a second judgement.",
      "**Prepare the LumenPay security review** before the 24th."],
     "Redefine the objective on the covered scope, or accept the mechanical ceiling\nat 96%?"),
    (3, "SignalOps signed off on their numbers: 41% of tickets resolved without a human\n"
        "and 0.084 EUR per resolution. The case study can go into the Northstar\n"
        "proposal as it stands.",
     "Three pilots out of five share the same usage profile. The pipeline looks\n"
     "diversified but rests on a single use case: one security objection will repeat\n"
     "across all of them.",
     ["**Write the SignalOps case study** while the numbers are fresh.",
      "**Re-run the eval set after the fix** before telling the board anything."],
     "Should the Northstar proposal include the ninety-day exit clause, or hold it\nback as a negotiating chip?"),
    (4, "The passage split is ready on the indexing side: one rule per passage, with its\n"
        "section title. What remains is re-running the evals to find out whether the\n"
        "eleven remaining failures really are scope rather than retrieval.",
     "The acceptance rate is both a sales argument and a product signal. While the\n"
     "measurement runs on 200 conversations, one point of improvement sits inside\n"
     "statistical noise: do not sell it as proof yet.",
     ["**Split long policies into passages** — everything else in the fix depends on it.",
      "**Prepare the Northstar board demo** from a real ticket in their own queue."],
     "Should the acceptance score be exposed in the product, or kept as an internal\ninstrument until the sample is solid?"),
]
for offset, follow_up, blind_spot, actions, question in briefs:
    d = day(offset)
    numbered = "\n".join(f"{i + 1}. {line}" for i, line in enumerate(actions))
    write(f"06-Daily/{d.isoformat()}.md", {
        "type": "daily", "title": f"Daily Brief - {d.isoformat()}", "date": d.isoformat(),
        "week": week_label(d), "status": "draft", "generated_by": "ai:claude",
        "generated_at": iso(d, "06:10:00"), "created": iso(d, "06:10:00"),
        "updated": iso(d, "06:10:00"), "inbox_count": 6, "signal_count": 3,
        "open_task_count": 8, "objective_count": 3, "created_task_count": 1,
        "suggestion_count": 2, "generation_status": "ai",
        "skills": ["09-Skills/synthesize-daily/SKILL.md"],
        "sources": ["04-Objectives/accepted-support-answers.md", "04-Objectives/reach-10000-mrr.md"],
    }, f"""## Daily Brief - {d.isoformat()}

### Follow-up
{follow_up}

### Today's actions
{numbered}

### Blind spots
{blind_spot}

### Question to explore
{question}
""")

# ------------------------------------------------------------- weekly reviews
weeklies = [
    (7, 6350, 9, 81, 93.4, 98.1, 692,
     "The passage split is in place and the re-run evals move acceptance from 91.6%\n"
     "to 93.4%. The Northstar annual proposal went out at 18,000 EUR. Full training\n"
     "week: six sessions out of six, long run of 34.8 km with no pain.",
     "The eleven remaining failures are all outside the documented scope: no product\n"
     "fix will catch them. The LumenPay security review has not started while the\n"
     "deadline is the 24th.",
     ["Measure acceptance on the covered scope and document the rest as a stated limit.",
      "Move the eval protocol to 500 conversations with a second judgement.",
      "Put the security review ahead of protocol v2 if the two collide."]),
    (14, 5600, 9, 78, 91.9, 96.8, 704,
     "SignalOps agreed to serve as a numbers-backed case study. The twenty-seven eval\n"
     "failures are sorted into two clean families, which makes the fix plannable.\n"
     "Chasing the three dormant pilots produced two replies within a day.",
     "The Enterprise security questionnaire still has no owner. Long policies are\n"
     "not split yet, so the acceptance rate does not move.",
     ["Split policies by passage rather than rewrite the prompt.",
      "Treat out-of-scope questions as a sales topic, not a product one.",
      "Block the training mornings before booking any meeting."]),
]
for offset, mrr, pilots, activation, acceptance, sourced, cloud, won, blocked, decisions in weeklies:
    end = day(offset)
    start = end - timedelta(days=6)
    decided = "\n".join(f"- {line}" for line in decisions)
    write(f"07-Weekly/{week_label(end)}.md", {
        "type": "weekly", "title": f"Weekly Review - {week_label(end)}", "week": week_label(end),
        "week_start": start.isoformat(), "week_end": end.isoformat(), "status": "draft",
        "generated_by": "ai:claude", "generated_at": iso(end, "18:30:00"),
        "created": iso(end, "18:30:00"), "updated": iso(end, "18:30:00"),
        "open_task_count": 8, "done_task_count": 6, "daily_count": 5, "objective_count": 3,
    }, f"""## Weekly Review - {week_label(end)}

### Numbers
- MRR: {mrr:,} EUR
- Active pilots: {pilots}
- Day-7 activation: {activation}%
- Acceptance: {acceptance}%
- Sourced answers: {sourced}%
- Cloud spend: {cloud} EUR

### What actually moved
{won}

### What did not
{blocked}

### Decisions
{decided}
""")

# ------------------------------------------------------------------- finance
PORTFOLIO = {"etf": 18432, "savings": 14800, "crypto": 5044, "stock": 4920}
positions = [
    ("world-index-fund", "World index fund", "etf", 320, 57.60, "IE00B4L5Y983", 1),
    ("safety-savings", "Safety savings", "savings", 1, 14800.00, "", 2),
    ("bitcoin", "Bitcoin", "crypto", 0.052, 97000.00, "BTC", 3),
    ("nvidia-shares", "NVIDIA shares", "stock", 24, 205.00, "NVDA", 4),
]
for slug, title, asset_type, quantity, unit_price, identifier, order in positions:
    front = {
        "type": "finance-position", "title": title, "status": "active",
        "asset_type": asset_type, "quantity": quantity, "unit_price": unit_price,
        "currency": "EUR", "price_source": "manual", "market_provider": "manual",
        "price_updated_at": TODAY.isoformat(), "created": iso(day(180)), "updated": NOW,
        "sort_order": order, "tags": [],
    }
    if identifier:
        front["market_identifier"] = identifier
        front["market_change_percent"] = round(random.uniform(-1.5, 3.2), 2)
    write(f"10-Finance/{slug}.md", front, f"# {title}")

points = []
for offset in (42, 35, 28, 21, 14, 7, 3, 2, 1, 0):
    ramp = lambda rate: (1 + rate) ** -offset
    by_type = {
        "etf": round(PORTFOLIO["etf"] * ramp(0.0013) * random.uniform(0.996, 1.004)),
        "savings": PORTFOLIO["savings"] - offset * 22,
        "crypto": round(PORTFOLIO["crypto"] * ramp(0.0022) * random.uniform(0.965, 1.035)),
        "stock": round(PORTFOLIO["stock"] * ramp(0.0026) * random.uniform(0.98, 1.02)),
    }
    if offset == 0:
        by_type = dict(PORTFOLIO)
    points.append({"date": day(offset).isoformat(), "currency": "EUR",
                   "total": sum(by_type.values()), "byType": by_type, "byAsset": {}})
write_json("00-System/.finance-history.json", {"version": 1, "points": points})

# -------------------------------------------------------------------- budget
budget = {
    "month": TODAY.strftime("%Y-%m"),
    "income": "5600",
    "fixedItems": [
        {"id": "f1", "label": "Flat", "category": "housing", "price": "1120", "frequency": "monthly"},
        {"id": "f2", "label": "Energy and internet", "category": "other", "price": "139", "frequency": "monthly"},
        {"id": "f3", "label": "Insurance", "category": "insurance", "price": "91", "frequency": "monthly"},
        {"id": "f4", "label": "Transport", "category": "transport", "price": "72", "frequency": "monthly"},
    ],
    "variableItems": [
        {"id": "v1", "label": "Groceries", "category": "food", "price": "460"},
        {"id": "v2", "label": "Restaurants and cafes", "category": "leisure", "price": "280"},
        {"id": "v3", "label": "Trail and health", "category": "health", "price": "210"},
        {"id": "v4", "label": "Books and gear", "category": "shopping", "price": "160"},
    ],
    "subscriptions": [
        {"id": "s1", "label": "Cloud backup", "category": "other", "price": "12", "frequency": "monthly"},
        {"id": "s2", "label": "Design tools", "category": "work", "price": "144", "frequency": "yearly"},
    ],
}
write("00-System/Budget.md", {
    "type": "system", "role": "budget", "title": "Monthly budget",
    "created": iso(day(60)), "updated": NOW, "month": TODAY.strftime("%Y-%m"),
    "income": 5600, "savings_target": 1800,
}, "# Monthly budget\n\nManaged from the app's Budget page. Stored as JSON below; do not edit by hand.\n\n```json\n"
   + json.dumps(budget, ensure_ascii=False, indent=2) + "\n```")

# ------------------------------------------------------------------ business
prospects = [
    ("lumenpay", "LumenPay", "Product lead", "Content", 18000, "qualified", 45,
     "Close the security questionnaire", 7,
     "B2B fintech, 32 agents and high compliance requirements. Priority on refusals\nand auditability."),
    ("parcelfox", "ParcelFox", "Head of support", "Event", 12000, "qualified", 40,
     "Re-run the demo on three logistics tickets", 2,
     "Logistics platform, 14 agents and heavy volume spikes. Interested in\nper-country rules."),
    ("signalops", "SignalOps", "Operations lead", "Outbound", 14400, "contacted", 30,
     "Send the numbers-backed case study", 0,
     "Observability tool with a deeply technical documentation base and 11 support\nagents."),
    ("northstar", "Northstar", "Executive board", "Founder-led", 18000, "proposal", 60,
     "Follow up after the board meeting", 4,
     "Annual Team plan proposed at 18,000 EUR, ninety-day exit clause included.\nDecision expected at the board meeting."),
    ("orbe-systems", "Orbe Systems", "Head of customer service", "Referral", 9600, "won", 100,
     "Contract signed, rollout complete", -13,
     "Annual renewal signed after a three-month pilot. 22 agents, multilingual\ndocumentation base."),
]
for slug, company, contact, source, value, stage, probability, action, action_offset, body in prospects:
    write(f"12-Business/prospect-{slug}.md", {
        "type": "business-record", "record_type": "prospect",
        "status": "won" if stage == "won" else "active", "company": company,
        "contact_name": contact, "email": f"contact@{slug.replace(' ', '')}.example.com",
        "source": source, "value": value, "currency": "EUR", "stage": stage,
        "probability": probability, "next_action": action,
        "next_action_date": day(-action_offset).isoformat(),
        "created": iso(day(30)), "updated": iso(day(1)), "title": company,
    }, f"# {company}\n\n{body}")

invoices = [
    ("2026-036", "Mesa Cloud", 4500, "paid", 40, 26, 28, "First Team quarter, paid up front."),
    ("2026-037", "Vela Works", 1500, "sent", 38, 17, None, "July Team subscription. Courtesy reminder sent, second one due."),
    ("2026-039", "Pine Labs", 4500, "paid", 20, 12, 14, "First Team quarter paid up front after the pilot converted."),
    ("2026-040", "Orbe Systems", 9600, "paid", 16, 2, 13, "Annual Team renewal, paid in full."),
    ("2026-041", "Mesa Cloud", 1500, "paid", 6, -8, 6, "August Team subscription, settled on the day it was issued."),
    ("2026-042", "SignalOps", 750, "paid", 6, -8, 5, "August pilot on one channel, invoiced after the trial."),
    ("2026-043", "ParcelFox", 750, "sent", 6, -8, None, "August logistics pilot, one channel and 2,000 conversations included."),
    ("2026-044", "Pine Labs", 4500, "sent", 3, -11, None, "Second Team quarter, issued after the tacit renewal."),
]
for number, client, amount, status, issue_offset, due_offset, paid_offset, body in invoices:
    front = {
        "type": "business-record", "record_type": "invoice", "status": status,
        "invoice_number": f"KRN-{number}", "client": client,
        "client_email": f"finance@{client.split()[0].lower()}.example.com",
        "amount": amount, "currency": "EUR",
        "issue_date": day(issue_offset).isoformat(), "due_date": day(due_offset).isoformat(),
        "created": iso(day(issue_offset)), "updated": iso(day(paid_offset if paid_offset else issue_offset)),
        "title": f"KRN-{number} - {client}",
    }
    if paid_offset is not None:
        front["paid_at"] = day(paid_offset).isoformat()
    write(f"12-Business/invoice-{number}.md", front, f"# KRN-{number} - {client}\n\n{body}")

# --------------------------------------------------------------------- trail
# The plan ships as a fixture: the app validates plan-data.json strictly (run
# minutes per week, no back-to-back runs on light weeks, a race session on the
# event day) and silently replaces a rejected plan with a legacy 26 km one.
plan = json.load(open(os.path.join(HERE, "fixtures", "utmb-plan.json"), encoding="utf-8"))
RACE_DAY = date.fromisoformat(plan["objective"]["event_date"])
PLAN_START = TODAY - timedelta(days=TODAY.weekday()) - timedelta(weeks=18)
plan["objective"]["start_date"] = PLAN_START.isoformat()
plan["objective"]["event_date"] = (PLAN_START + timedelta(weeks=len(plan["weeks"]) - 1, days=6)).isoformat()
RACE_DAY = date.fromisoformat(plan["objective"]["event_date"])
for index, week in enumerate(plan["weeks"]):
    monday = PLAN_START + timedelta(weeks=index)
    sunday = monday + timedelta(days=6)
    week["dates"] = f"{monday.strftime('%b %-d')} - {sunday.strftime('%b %-d')}"
write_json("08-Projects/Training/plan-data.json", plan)

CURRENT_WEEK = (TODAY - PLAN_START).days // 7 + 1
CANCELLED_WEEK = 5
MOVED_WEEK = 4
HR_BOUNDS = [(90, 119), (120, 144), (145, 164), (165, 190)]


def zones(dur_s, split):
    return [{"zone": zone, "label": f"Z{zone}", "seconds": round(dur_s * share),
             "percent": round(share * 100), "low_boundary": low, "high_boundary": high}
            for (zone, share), (low, high) in zip(split, HR_BOUNDS)]


def target_minutes(session):
    if session.get("duration_min"):
        return session["duration_min"]
    return 45


def build_activity(session, week, when, weekday, activity_id):
    minutes = target_minutes(session) * random.uniform(0.94, 1.06)
    dur_s = round(minutes * 60)
    sport = session["sport"]
    quality = any(word in f"{session['title']} {session['intensity']}".lower()
                  for word in ("race", "climb", "uphill", "z2-z3", "reminder"))
    common = {
        "id": activity_id, "date": when.isoformat(), "week": week["week"], "weekday": weekday,
        "kind": sport, "dur_s": dur_s, "avg_stride_length_cm": None,
        "vertical_oscillation_cm": None, "vertical_ratio": None, "ground_contact_time_ms": None,
        "stamina_start": None, "stamina_end": None, "stamina_min": None, "vo2_max": None,
        "power_zones": [],
    }
    if sport == "run":
        hilly = any(word in session["title"].lower() for word in ("long", "climb", "uphill", "durability"))
        pace = round(random.uniform(352, 372) * (1.18 if hilly else 1.0))
        km = round(dur_s / pace, 1)
        hr = round(random.uniform(139, 152))
        split = [(1, 0.10), (2, 0.36), (3, 0.40), (4, 0.14)] if quality else [(1, 0.12), (2, 0.58), (3, 0.26), (4, 0.04)]
        common.update({
            "type": "running", "name": session["title"], "km": km, "pace_s_per_km": pace, "hr": hr,
            "dplus": round((week.get("dplus") or 0) * (0.42 if hilly else 0.04) + random.uniform(10, 40)),
            "avg_power": None, "normalized_power": None, "calories": round(km * random.uniform(60, 66)),
            "training_load": round(dur_s / 60 * (2.9 if quality else 2.2)),
            "max_hr": hr + round(random.uniform(16, 24)),
            "avg_cadence": round(random.uniform(169, 175)), "max_cadence": round(random.uniform(181, 189)),
            "avg_stride_length_cm": round(random.uniform(100, 108)),
            "vertical_oscillation_cm": round(random.uniform(8.2, 9.0), 1),
            "vertical_ratio": round(random.uniform(7.5, 8.3), 1),
            "ground_contact_time_ms": round(random.uniform(236, 250)),
            "aerobic_training_effect": round(random.uniform(3.4, 3.9) if quality else random.uniform(2.8, 3.3), 1),
            "anaerobic_training_effect": round(random.uniform(1.4, 1.9), 1) if quality else 0.2,
            "training_effect_label": "TEMPO" if quality else "AEROBIC_BASE",
            "stamina_start": 100, "stamina_end": round(random.uniform(68, 86)),
            "stamina_min": round(random.uniform(62, 80)),
            "hr_zones": zones(dur_s, split), "time_in_zone2_s": round(dur_s * split[1][1]),
        })
    elif sport == "ride":
        km = round(dur_s / 3600 * random.uniform(22, 25), 1)
        hr = round(random.uniform(120, 130))
        power = round(random.uniform(115, 130))
        split = [(1, 0.46), (2, 0.44), (3, 0.08), (4, 0.02)]
        common.update({
            "type": "cycling", "name": session["title"], "km": km, "pace_s_per_km": round(dur_s / km),
            "hr": hr, "dplus": round(random.uniform(80, 120)), "avg_power": power,
            "normalized_power": round(power * 1.07), "calories": round(dur_s / 3600 * random.uniform(400, 460)),
            "training_load": round(dur_s / 60 * 0.9), "max_hr": hr + round(random.uniform(12, 20)),
            "avg_cadence": round(random.uniform(82, 88)), "max_cadence": round(random.uniform(99, 107)),
            "aerobic_training_effect": round(random.uniform(1.9, 2.3), 1), "anaerobic_training_effect": 0.1,
            "training_effect_label": "RECOVERY", "hr_zones": zones(dur_s, split),
            "power_zones": zones(dur_s, split), "time_in_zone2_s": round(dur_s * 0.44),
        })
    else:
        hr = round(random.uniform(106, 118))
        split = [(1, 0.42), (2, 0.46), (3, 0.10), (4, 0.02)]
        common.update({
            "type": "strength_training", "name": session["title"], "km": 0, "pace_s_per_km": None,
            "hr": hr, "dplus": 0, "avg_power": None, "normalized_power": None,
            "calories": round(dur_s / 60 * random.uniform(6.0, 6.8)), "training_load": round(dur_s / 60 * 0.6),
            "max_hr": hr + round(random.uniform(20, 28)), "avg_cadence": None, "max_cadence": None,
            "aerobic_training_effect": round(random.uniform(1.2, 1.6), 1),
            "anaerobic_training_effect": round(random.uniform(0.4, 0.8), 1),
            "training_effect_label": "RECOVERY", "hr_zones": zones(dur_s, split),
            "time_in_zone2_s": round(dur_s * 0.46),
        })
    return common


FEELINGS = ["good", "great", "good", "great", "ok"]
NOTES = {
    "run": ["Easy pace held from start to finish, breathing very steady.",
            "Legs light, no niggle in the calf.",
            "Good tolerance of the vertical, fuelling well calibrated.",
            "Descents smoother, footing noticeably more secure."],
    "ride": ["Very supple spin, legs fresher coming home.",
             "Held the target power, cadence steady."],
    "strength": ["Good energy, no set taken to failure.",
                 "Back solid, low fatigue afterwards.",
                 "Calf eccentrics held well, no pain."],
}

activities, feedback, overrides = [], [], []
for week in plan["weeks"]:
    cancelled = next((s for s in week["sessions"] if not s.get("optional") and s["sport"] == "strength"), None) \
        if week["week"] == CANCELLED_WEEK else None
    for session in week["sessions"]:
        if session.get("optional") or session["sport"] not in ("run", "ride", "strength"):
            continue
        if session is cancelled:
            overrides.append({
                "id": f"demo-override-{session['id']}", "created_at": iso(PLAN_START + timedelta(weeks=week["week"] - 1)),
                "session_id": session["id"], "week": week["week"], "action": "cancel", "to_weekday": None,
                "reason": "Client trip, session cancelled rather than moved.", "activity_id": None,
            })
            continue
        moved = week["week"] == MOVED_WEEK and session["weekday"] == 6 and session["sport"] == "run"
        weekday = 5 if moved else session["weekday"]
        when = PLAN_START + timedelta(weeks=week["week"] - 1, days=weekday)
        if when > TODAY:
            continue
        activity_id = f"demo-activity-{len(activities) + 1:03d}"
        activities.append(build_activity(session, week, when, weekday, activity_id))
        feedback.append({
            "activityId": activity_id, "rpe": 5 if session["sport"] == "strength" else 4,
            "pain": 0, "feeling": FEELINGS[len(activities) % len(FEELINGS)],
            "note": NOTES[session["sport"]][len(activities) % len(NOTES[session["sport"]])],
            "createdAt": iso(when, "18:30:00"),
        })

# Captured early in the week, the current week holds nothing at all: every
# running stat reads zero even with eighteen weeks behind it. Pull the week's
# own run and strength onto today, which is what an athlete does with a free
# Monday — the matcher reads them as sessions done ahead of their slot.
current = next((w for w in plan["weeks"] if w["week"] == CURRENT_WEEK), None)
for sport in ("run", "strength"):
    if not current or any(a["week"] == CURRENT_WEEK and a["kind"] == sport for a in activities):
        continue
    session = next((s for s in current["sessions"] if not s.get("optional") and s["sport"] == sport), None)
    if not session or session["weekday"] <= TODAY.weekday():
        continue
    activities.append(build_activity(session, current, TODAY, TODAY.weekday(), f"demo-activity-{len(activities) + 1:03d}"))

write_json("08-Projects/Training/plan-overrides.json", {"overrides": overrides})
write_json("08-Projects/Trail-26K/sync-data.json", {"generated_at": NOW, "activities": activities})
write_json("08-Projects/Trail-26K/feedback-data.json", {"feedback": feedback[:-2]})

health_days = []
for offset in range(41, -1, -1):
    d = day(offset)
    if d < PLAN_START:
        continue
    sleep_h = round(random.uniform(6.6, 8.4), 1)
    health_days.append({
        "date": d.isoformat(), "sleep_score": round(min(96, 40 + sleep_h * 7 + random.uniform(-5, 5))),
        "sleep_h": sleep_h, "rhr": round(random.uniform(46, 52)), "hrv_avg": round(random.uniform(70, 84)),
        "bb_min": round(random.uniform(5, 14)), "bb_max": round(random.uniform(82, 95)),
        "readiness": round(random.uniform(62, 88)),
    })
write_json("08-Projects/Trail-26K/health-data.json", {
    "generated_at": NOW,
    "user": {"max_hr": 191, "max_hr_source": "field_test", "lactate_threshold_hr": 174},
    "days": health_days,
})

weeks_elapsed = max(1, CURRENT_WEEK)
vo2_history = []
for offset in range(weeks_elapsed * 7 - 7, -1, -4):
    d = day(offset)
    if d < PLAN_START:
        continue
    precise = round(46.2 + (d - PLAN_START).days / 7 * 0.16, 1)
    vo2_history.append({"date": d.isoformat(), "value": round(precise), "precise": precise})

status_history = []
for week in range(2, weeks_elapsed + 1):
    d = PLAN_START + timedelta(weeks=week, days=-1)
    if d >= TODAY:
        break
    chronic = round(240 + week * 14 + random.uniform(-8, 8))
    acwr = round((0.88 if week % 4 == 0 else 1.12) * random.uniform(0.97, 1.03), 2)
    status_history.append({
        "date": d.isoformat(), "phrase": "RECOVERY" if week % 4 == 0 else "PRODUCTIVE",
        "acute_load": round(chronic * acwr), "chronic_load": chronic,
        "acwr": acwr, "acwr_status": "OPTIMAL",
    })

last_day = health_days[-1]
write_json("08-Projects/Trail-26K/performance-data.json", {
    "generated_at": NOW, "history_start": PLAN_START.isoformat(),
    "vo2_history": vo2_history, "training_status_history": status_history,
    "readiness": {
        "date": last_day["date"], "score": last_day["readiness"],
        "level": "VERY_GOOD" if last_day["readiness"] >= 80 else "GOOD",
        "sleep_score": last_day["sleep_score"],
        "hrv_weekly_average": round(sum(d["hrv_avg"] for d in health_days[-7:]) / 7),
        "recovery_time_minutes": 540,
    },
})

print(f"demo vault written to {ROOT}: {len(tasks)} tasks, {len(briefs)} briefs, "
      f"{len(wiki)} wiki notes, {len(activities)} training sessions, "
      f"race day {RACE_DAY.isoformat()} (week {CURRENT_WEEK}/{len(plan['weeks'])})")
