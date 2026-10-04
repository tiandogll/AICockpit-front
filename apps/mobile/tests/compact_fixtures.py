"""Isolated browser-only layout fixtures; never real learner or scoring data.

Install in a fresh Playwright context before opening the mobile app. Every API
request is intercepted: unknown reads and ALL mutations fail closed, are logged,
and never reach the local API, database, model provider, or another network API.
The fake session tokens only exist in this test context's sessionStorage. This
module is not imported by either frontend runtime and cannot alter real records.
"""

import json
import re
from urllib.parse import parse_qs, urlsplit


SESSION_ID = "00000000-0000-4000-8000-000000000101"
REPORT_ID = "00000000-0000-4000-8000-000000000201"
PLAN_ID = "00000000-0000-4000-8000-000000000301"
PENDING_SESSION_ID = "00000000-0000-4000-8000-000000000102"
PENDING_REPORT_ID = "00000000-0000-4000-8000-000000000202"
ORGANIZATION_ID = "00000000-0000-4000-8000-000000000401"
USER_ID = "00000000-0000-4000-8000-000000000501"
ITEM_ID = "00000000-0000-4000-8000-000000000601"
COMPLETED_AT = "2026-10-03T12:30:00+08:00"
CREATED_AT = "2026-10-03T12:00:00+08:00"

# Convenient explicit aliases for screenshot harnesses.
FIXTURE_SESSION_ID = SESSION_ID
FIXTURE_REPORT_ID = REPORT_ID
FIXTURE_PLAN_ID = PLAN_ID

DIMENSIONS = [
    ("foundations", "基础认知", 42.6, "L2"),
    ("prompting", "提示词工程", 76.3, "L4"),
    ("tool_use", "工具使用", 62.4, "L3"),
    ("evaluation", "结果评估", 46.8, "L2"),
    ("collaboration", "人机协同", 71.9, "L4"),
    ("ethics", "伦理合规", 65.2, "L3"),
]


def dimensions():
    return [dict(code=code, index=index, level=level, evidence_count=3)
            for code, _name, index, level in DIMENSIONS]


def blueprints():
    result = []
    modes = (("rapid", "极速测", 12, 18, (12, 0, 0)),
             ("standard", "标准测", 12, 18, (6, 3, 3)),
             ("specialized", "专项测", 2, 5, (2, 0, 0)),
             ("fixed", "验证固定卷", 12, 12, (6, 3, 3)))
    for mode, label, minimum, maximum, counts in modes:
        for scenario, name in (("higher_education", "高校学习"), ("enterprise", "企业办公")):
            result.append({
                "id": f"fixture-{mode}-{scenario}", "name": f"AI能力{label} · {name}",
                "mode": mode, "scenario": scenario, "min_items": minimum,
                "max_items": maximum,
                "item_type_minimums": dict(zip(("objective", "dialogue", "practical"), counts)),
                "dimension_codes": ["collaboration"] if mode == "specialized" else [x[0] for x in DIMENSIONS],
                "assessment_time_limit_seconds": None,
                "organization_ids": [ORGANIZATION_ID], "data_origin": None,
            })
    return result


def assessment_configuration():
    return {"dimensions": {code: 2 for code, *_ in DIMENSIONS},
            "item_type_minimums": {"objective": 6, "dialogue": 3, "practical": 3}}


def session(identifier=SESSION_ID):
    return {
        "id": identifier, "organization_id": ORGANIZATION_ID,
        "blueprint_version_id": "fixture-standard-higher_education", "mode": "standard",
        "scenario": "higher_education", "status": "completed", "data_origin": None,
        "blueprint_snapshot": {"name": "AI能力标准测 · 高校学习",
                               "configuration": assessment_configuration()},
        "created_at": CREATED_AT, "completed_at": COMPLETED_AT, "ended_at": COMPLETED_AT,
        "ended_reason": "completed", "expires_at": None, "paused_at": None,
        "activity_revision": 1, "replayed": False,
    }


def decision(code, name):
    return {
        "decision_id": f"fixture-decision-{code}", "item_type": "dialogue",
        "score": 2.5, "confidence": 0.86, "source": "human",
        "policy_version": "fixture-policy-v1",
        "tasks": [{"id": f"fixture-task-{code}", "role": "evidence-review",
                   "model": "browser-layout-fixture", "prompt_version": "fixture-only",
                   "result_hash": "a" * 64, "evidence": [{
                       "criterion_code": f"{code}-verification", "score": 2.5,
                       "confidence": 0.86, "quote": "先核对原始材料中的事实，再标记需要进一步确认的推断。",
                       "rationale": f"已说明{name}的核验顺序，并为不确定的信息保留检查线索；仍需进一步明确来源位置和验收条件。",
                       "evidence_hash": "b" * 64, "verified": True,
                   }]}],
    }


def report(identifier=SESSION_ID, pending=False):
    projected = {}
    for code, name, index, level in DIMENSIONS:
        opened = code in ("foundations", "evaluation")
        projected[code] = {
            "objective_measurement": {"theta": (index - 50) / 30,
                                      "standard_error": 0.64, "evidence_count": 2, "level": level},
            "rubric_measurement": {"mean_score": 2.5 if opened else None,
                                   "mean_confidence": 0.86 if opened else None,
                                   "completed": 1 if opened else 0,
                                   "pending": 1 if pending and opened else 0,
                                   "decisions": [decision(code, name)] if opened else []},
            "synthesis": {"index": index, "level": level,
                          "method_version": "fixture-evidence-index-v1", "evidence_count": 3},
        }
    return {
        "id": PENDING_REPORT_ID if identifier == PENDING_SESSION_ID else REPORT_ID,
        "session_id": identifier, "is_complete": not pending, "revision": 2,
        "processing": {"state": "needs_review" if pending else "complete",
                       "automatic_scoring_enabled": True, "failed_answers": 0,
                       "pending_answers": 0, "review_answers": 2 if pending else 0},
        "payload": {
            "data_origin": None,
            "assessment": {"mode": "standard", "scenario": "higher_education", "data_origin": None,
                           "blueprint": {"configuration": assessment_configuration()}},
            "summary": {"answered": 12, "pending_scoring": 0,
                        "needs_review": 2 if pending else 0, "failed_scoring": 0,
                        "blocked_scoring": 0, "scored_open_answers": 2},
            "dimensions": projected, "measurement_status": "needs_review" if pending else "complete",
            "measurement_note": "浏览器布局测试样本，不是任何真实学员的报告。",
            "scoring_setup_issues": [], "scoring_policy_version": "fixture-policy-v1",
            "recommendations": [
                {"dimension_code": "foundations", "action": "先练习区分原始材料中的事实和模型推断，记录事实来源，再用小样本验证输出。"},
                {"dimension_code": "evaluation", "action": "把验收标准写成核验清单，逐项复核事实与证据，记录无法确认的信息。"}],
            "strengths": ["prompting", "collaboration"],
        },
    }


def summary(identifier=SESSION_ID, pending=False):
    return {"organization_id": ORGANIZATION_ID, "data_origin": None,
            "id": PENDING_REPORT_ID if identifier == PENDING_SESSION_ID else REPORT_ID,
            "session_id": identifier, "name": "AI能力标准测 · 高校学习",
            "mode": "standard", "scenario": "higher_education",
            "status": "needs_review" if pending else "complete",
            "completed_at": COMPLETED_AT, "revision": 2, "dimensions": dimensions()}


def training_plan():
    lesson = {
        "code": "foundations-evidence", "title": "分清事实与模型推断",
        "objective": "识别输出中的事实、建议与推断，为可核验的结论保留来源。",
        "paragraphs": ["模型生成的文字可能流畅，但流畅并不等于事实正确。先找到能够直接核对的原始材料，再决定是否采纳。",
                       "把材料中已有的事实、模型建议和没有出处的推断分开记录。找不到证据时，写明待确认，不把推断当成结论。"],
        "case": {"scenario": "课程项目要求从公开材料提取活动日期、负责人和待办事项。",
                 "pitfall": "直接采用模型补充的负责人姓名，没有检查原始材料。",
                 "approach": "逐条标注原文位置，保留缺失项，并列出下一步需要谁确认。"},
        "steps": ["保留公开原始材料并标出可核验的事实。", "检查每条结论能否定位到原文。",
                  "记录未知信息、核验方法与验收条件。"],
        "reflection_questions": ["哪些信息来自原文，哪些属于推断？", "缺失信息需要向谁核实？"],
    }
    tasks = [
        {"id": "fixture-learning", "sequence": 1, "kind": "learning", "title": "阅读与反思：区分事实与推断",
         "status": "completed", "content": {"instructions": "阅读方法和案例，写下一个应用场景、一个限制和你的核验步骤。",
                                             "lessons": [lesson], "feedback_mode": "local_checklist_v2",
                                             "next_step": "在下一项练习中应用核验方法，保留每条事实的来源。"},
         "supplemental_lessons": [],
         "submission": {"response": "我会把课程项目材料中的日期和负责人逐条与原文核对。对于原文未说明的信息，标记为待确认，并记录需要向组织者询问的问题。"},
         "feedback": "已保存学习反思。请自查是否同时包含应用场景、风险与核验方法；保存成功不代表能力已提高。",
         "completed_at": "2026-10-03T13:00:00+08:00"},
        {"id": "fixture-exercise", "sequence": 2, "kind": "exercise", "title": "给结论找到证据，给未知信息留出口",
         "status": "pending", "content": {"instructions": "根据公开活动材料完成练习，说明事实依据和不确定的信息。",
                                             "prompt": "材料写明：活动计划周五举行，负责人尚未确定。模型建议让小林负责。请区分材料事实与模型建议，说明还需确认什么，以及如何验证最后的安排。",
                                             "checklist": ["标出原始材料能够直接支持的事实。", "区分模型建议与确定结论。", "说明未知信息的确认方式。"],
                                             "feedback_mode": "local_checklist_v2", "lessons": [lesson],
                                             "response_outline": "事实与出处、建议与推断、核验顺序与验收条件"},
         "supplemental_lessons": [], "submission": None, "feedback": None, "completed_at": None},
        {"id": "fixture-application", "sequence": 3, "kind": "application", "title": "将核验清单应用到新的任务",
         "status": "pending", "content": {"instructions": "选择公开或虚构材料，记录应用过程与核验依据。",
                                             "prompt": "将事实与推断区分方法应用到一个新的学习任务，说明验收规则。",
                                             "checklist": ["记录材料来源。", "保留验证步骤和检查结果。"]},
         "supplemental_lessons": [], "submission": None, "feedback": None, "completed_at": None},
        {"id": "fixture-retest", "sequence": 4, "kind": "retest", "title": "完成同方案正式复测",
         "status": "pending", "content": {"instructions": "学习、练习和应用核验完成后，再进行同方案复测。"},
         "supplemental_lessons": [], "submission": None, "feedback": None, "completed_at": None},
    ]
    return {
        "id": PLAN_ID, "organization_id": ORGANIZATION_ID, "source_report_id": REPORT_ID,
        "source_session_id": SESSION_ID, "source_report_revision": 2,
        "source_report_changed": False, "retest_available": True,
        "retest_unavailable_reason": None, "privacy_redacted": False, "replaces_plan_id": None,
        "template_version": "fixture-v1", "content_provenance": "browser-layout-fixture",
        "data_origin": None, "status": "active", "created_at": "2026-10-03T12:45:00+08:00",
        "completed_at": None, "dimensions": [dimensions()[0], dimensions()[3]],
        "assessment": {"mode": "standard", "scenario": "higher_education",
                       "blueprint_version_id": "fixture-standard-higher_education"},
        "completed_tasks": 1, "total_tasks": 4, "tasks": tasks, "retest": None, "comparison": None,
        "generation_basis": {"goal": "remedial", "goal_label": "针对提升",
                             "method": "根据来源报告的有证据维度与客观错题线索匹配练习。",
                             "completed_exercises": 0, "material_revisited": False,
                             "targets": [{"code": "foundations", "index": 42.6, "evidence_count": 3,
                                          "incorrect_count": 2, "objective_count": 2,
                                          "question_sequences": [1, 7], "focus_labels": ["事实与推断", "来源核验"],
                                          "reason": "已测维度有至少两项证据，可优先检查事实核验方法。"}]},
    }


def issued_items():
    return [{"item_version_id": ITEM_ID if i == 1 else f"fixture-item-{i}", "sequence": i,
             "item_type": "objective" if i <= 6 else "dialogue" if i <= 9 else "practical",
             "dimension_code": DIMENSIONS[(i - 1) % 6][0], "answered_at": COMPLETED_AT, "flagged": i == 2}
            for i in range(1, 13)]


def workspace(identifier):
    return {"session": session(identifier), "server_now": COMPLETED_AT,
            "blueprint_name": "AI能力标准测 · 高校学习", "min_items": 12, "max_items": 18,
            "answered_count": 12, "dispatched_count": 12, "flagged_count": 1,
            "current_item": None, "items": issued_items(), "can_complete": False,
            "completion_reason": "completed", "stopping_policy_version": "fixture-only",
            "unmet_dimensions": [], "unmet_item_types": [],
            "type_coverage": [dict(item_type=kind, answered_count=count, minimum=count)
                              for kind, count in (("objective", 6), ("dialogue", 3), ("practical", 3))]}


def review(identifier, item_id):
    listed = next((item for item in issued_items() if item["item_version_id"] == item_id), issued_items()[0])
    item = {"session_id": identifier, "item_version_id": item_id, "sequence": listed["sequence"],
            "item_type": listed["item_type"], "dimension_code": listed["dimension_code"], "difficulty": 0.4,
            "stem": "模型给出了流畅的项目摘要，但其中一条结论没有原文依据。你应该如何处理？",
            "configuration": {"options": [{"value": "A", "label": "标记待确认，回到原始材料核对出处。"},
                                            {"value": "B", "label": "直接采用流畅的结论，不再核验。"}]}}
    return {"item": item, "response": {"selected_option": "A"} if listed["item_type"] == "objective"
            else {"final_response": "我会逐条核对原始材料，保留已知事实，对没有出处的信息标记待确认并列出核验步骤。"},
            "draft": None, "dialogue_turns": [], "answered_at": COMPLETED_AT, "read_only": True}


def install_fixtures(context, state):
    """Install fail-closed read-only fixtures; state toggles only browser responses.

    state['plans'] = False hides saved plans; state['pending_report'] = True
    presents the main report as awaiting review. Unexpected/mutation requests are
    collected in state['unexpected'] for the harness to assert no fallback.
    """
    state.setdefault("unexpected", [])
    state.setdefault("requests", [])
    context.add_init_script("""(() => { try {
        sessionStorage.setItem('zhijian-auth-session', JSON.stringify({
            accessToken: 'BROWSER_LAYOUT_FIXTURE_NOT_A_VALID_TOKEN',
            refreshToken: 'BROWSER_LAYOUT_FIXTURE_NOT_A_VALID_REFRESH_TOKEN'
        }));
    } catch (_) {} })();""")

    def intercept(route):
        request = route.request
        url = urlsplit(request.url)
        path = url.path.split("/api/v1", 1)[1] or "/"
        query = parse_qs(url.query)
        method = request.method.upper()
        state["requests"].append(f"{method} {path}")
        headers = {"Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*",
                   "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS", "Cache-Control": "no-store"}

        def respond(payload, status=200):
            route.fulfill(status=status, content_type="application/json", headers=headers,
                          body=json.dumps(payload, ensure_ascii=False))

        if method == "OPTIONS":
            route.fulfill(status=204, headers=headers, body="")
            return
        if method not in ("GET", "HEAD"):
            state["unexpected"].append(f"BLOCKED MUTATION {method} {path}")
            respond({"detail": "Read-only browser layout fixture: mutations are blocked."}, 405)
            return
        owner_record = re.match(r"/(?:sessions|reports)/([^/]+)", path)
        if owner_record and owner_record.group(1) not in (SESSION_ID, PENDING_SESSION_ID):
            state["unexpected"].append(f"UNEXPECTED READ {method} {path}")
            respond({"detail": "Unknown session in browser layout fixture."}, 404)
            return
        answer_record = re.fullmatch(r"/sessions/[^/]+/items/([^/]+)/review", path)
        if answer_record and answer_record.group(1) not in {item["item_version_id"] for item in issued_items()}:
            state["unexpected"].append(f"UNEXPECTED READ {method} {path}")
            respond({"detail": "Unknown answer in browser layout fixture."}, 404)
            return
        if path == "/auth/me":
            respond({"id": USER_ID, "username": "layout.fixture", "email": None,
                     "display_name": "布局验证学员", "is_active": True,
                     "affiliation": "浏览器视觉测试", "specialty": "UI 检查", "learning_goal": "检查手机页面",
                     "created_at": CREATED_AT, "password_change_available": False})
        elif path == "/workspace/access":
            respond({"organizations": [{"id": ORGANIZATION_ID, "name": "布局测试平台",
                                        "role": "learner", "capabilities": [], "can_participate_assessment": True}],
                     "global_capabilities": [], "single_platform_enabled": True})
        elif path == "/workspace/features":
            respond({"training_enabled": state.get("training_enabled", True),
                     "training_content_status": "formative_preview", "growth_guide_mode": "deepseek",
                     "attachments_enabled": True, "assessment_in_progress": False})
        elif path == "/health":
            respond({"status": "ok", "source": "browser-layout-fixture"})
        elif path == "/assessment-definitions/launch-context":
            if state.get("launch_error"):
                respond({"detail": "布局测试：测评方案加载失败，请重新加载。"}, 503)
                return
            respond({"organizations": [{"id": ORGANIZATION_ID, "name": "布局测试平台", "role": "learner"}],
                     "blueprints": state.get("blueprints", blueprints()),
                     "active_sessions": state.get("active_sessions", [])})
        elif path == "/workspace/reports":
            rows = [summary(), summary(PENDING_SESSION_ID, True)]
            if query.get("status"):
                rows = [row for row in rows if row["status"] == query["status"][0]]
            for key in ("mode", "scenario"):
                if query.get(key):
                    rows = [row for row in rows if row[key] == query[key][0]]
            limit, offset = int(query.get("limit", [20])[0]), int(query.get("offset", [0])[0])
            respond({"items": rows[offset:offset + limit], "total": len(rows), "limit": limit, "offset": offset})
        elif path == "/workspace/overview":
            respond({"active_sessions": [], "recent_reports": [summary(), summary(PENDING_SESSION_ID, True)],
                     "report_count": 2, "service_status": {"state": "available", "label": "布局测试样本"}})
        elif path == "/workspace/trends":
            respond({"groups": [], "total": 0, "limit": 20, "offset": 0})
        elif path == "/workspace/history":
            respond({"items": [], "total": 0, "limit": 20, "offset": 0})
        elif path == "/training":
            rows = [training_plan()] if state.get("plans", True) else []
            if query.get("source_report_id"):
                rows = [row for row in rows if row["source_report_id"] == query["source_report_id"][0]]
            limit, offset = int(query.get("limit", [20])[0]), int(query.get("offset", [0])[0])
            respond({"items": rows[offset:offset + limit], "total": len(rows), "limit": limit, "offset": offset})
        elif path == f"/training/{PLAN_ID}":
            respond(training_plan())
        elif path in (f"/reports/{SESSION_ID}", f"/reports/{PENDING_SESSION_ID}"):
            identifier = path.rsplit("/", 1)[1]
            respond(report(identifier, identifier == PENDING_SESSION_ID or state.get("pending_report", False)))
        elif path in (f"/sessions/{SESSION_ID}", f"/sessions/{PENDING_SESSION_ID}"):
            respond(session(path.rsplit("/", 1)[1]))
        elif re.fullmatch(r"/sessions/[^/]+/workspace", path):
            respond(workspace(path.split("/")[2]))
        elif re.fullmatch(r"/sessions/[^/]+/items/[^/]+/review", path):
            parts = path.split("/")
            respond(review(parts[2], parts[4]))
        elif re.fullmatch(r"/sessions/[^/]+/dialogue/[^/]+/attachments", path):
            respond({"attachments": []})
        elif re.fullmatch(r"/sessions/[^/]+/practical/[^/]+", path):
            parts = path.split("/")
            respond({"workspace_id": "fixture-practical-workspace", "session_id": parts[2],
                     "item_version_id": parts[4], "state": "submitted", "task_type": "text",
                     "stem": "检查项目摘要中的事实与推断。", "media": None,
                     "max_ai_interactions": 3, "event_count": 0, "interaction_count": 0,
                     "artifact_count": 0, "submitted_at": COMPLETED_AT, "can_edit": False,
                     "events": [], "interactions": [], "artifacts": [], "replayed": False})
        else:
            state["unexpected"].append(f"UNEXPECTED READ {method} {path}")
            respond({"detail": f"No browser layout fixture exists for {method} {path}."}, 404)

    context.route("**/api/v1/**", intercept)
