"""Read-only mobile assessment boundary checks against isolated browser fixtures.

No real account, password, database, answer submission, model call, or API mutation
is used. compact_fixtures intercepts every API request and rejects unknown reads
and all writes. Each case uses a new context containing only fictional fixtures.

Run with the mobile dev server already running. Screenshots are test artifacts,
not records from a real learner. The PC frontend is read only for script parity.
"""

import argparse
from copy import deepcopy
import json
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

from compact_fixtures import (
    CREATED_AT,
    ORGANIZATION_ID,
    SESSION_ID,
    blueprints,
    install_fixtures,
)


def assert_business_script_preserved(project_root: Path | None = None) -> None:
    """Require exact script parity, allowing only mobile-relative import paths.

    Text reads normalize platform line endings. Whitespace before the mobile
    presentation-helper marker or closing script tag is not part of the logic.
    Any added/removed business statement, guard, watcher, or copy otherwise fails.
    """
    root = project_root or Path(__file__).resolve().parents[3]
    pc_path = root / "apps/web/src/views/AssessmentView.vue"
    mobile_path = root / "apps/mobile/src/MobileAssessment.vue"
    pc_source = pc_path.read_text(encoding="utf-8")
    mobile_source = mobile_path.read_text(encoding="utf-8")
    marker = "// Mobile presentation only;"
    assert marker in mobile_source, "Missing mobile presentation boundary marker"
    pc_script = pc_source.split("</script>", 1)[0].rstrip()
    mobile_script = mobile_source.split(marker, 1)[0].rstrip()
    mobile_script = mobile_script.replace("../../web/src/", "../")
    assert mobile_script == pc_script, (
        "Mobile assessment business logic differs from the read-only PC source. "
        "Keep guards, catalog selection, idempotency and session behavior in parity."
    )


def fixture_cases() -> dict:
    timed = blueprints()
    for blueprint in timed:
        if blueprint["mode"] == "standard":
            blueprint["assessment_time_limit_seconds"] = 120

    synthetic = blueprints()
    for blueprint in synthetic:
        blueprint["data_origin"] = "synthetic"

    mixed = blueprints()
    synthetic_standard = deepcopy(next(row for row in mixed if row["mode"] == "standard"))
    synthetic_standard["id"] = "fixture-synthetic-standard"
    synthetic_standard["data_origin"] = "synthetic"

    return {
        "empty": {"blueprints": []},
        "missing_rapid": {"blueprints": [row for row in blueprints() if row["mode"] != "rapid"]},
        "timed": {"blueprints": timed},
        "synthetic": {"blueprints": synthetic},
        # The synthetic scheme is deliberately first to prove default preference
        # depends on provenance, not the received catalog's ordering.
        "mixed": {"blueprints": [synthetic_standard] + mixed},
        "failure": {"launch_error": True},
        "resume": {"active_sessions": [{
            "id": SESSION_ID,
            "organization_id": ORGANIZATION_ID,
            "blueprint_version_id": "fixture-standard-higher_education",
            "blueprint_name": "AI能力标准测 · 高校学习",
            "mode": "standard", "scenario": "higher_education", "status": "active",
            "created_at": CREATED_AT, "data_origin": None,
        }]},
    }


def assert_read_only(state: dict, errors: list, page, name: str) -> None:
    writes = [request for request in state["requests"]
              if request.startswith(("POST ", "PUT ", "PATCH ", "DELETE "))]
    assert not writes, f"{name}: unexpected write attempt (fixture blocked it): {writes}"
    assert not state["unexpected"], f"{name}: unmatched fixture requests: {state['unexpected']}"
    assert not errors, f"{name}: browser script errors: {errors}"
    assert page.locator(".mobile-content").evaluate(
        "element => element.scrollWidth <= element.clientWidth + 1"
    ), f"{name}: horizontal overflow"
    assert not page.get_by_role("alert").count(), f"{name}: unexpected error alert"


def check_case(browser, base_url: str, output: Path, name: str, state: dict) -> dict:
    context = browser.new_context(viewport={"width": 390, "height": 844}, has_touch=True)
    install_fixtures(context, state)
    errors = []
    page = context.new_page()
    page.on("pageerror", lambda error: errors.append(str(error)))
    try:
        page.goto(base_url.rstrip("/") + "/assessment", wait_until="networkidle")
        page.get_by_test_id("mobile-assessment").wait_for()
        start = page.get_by_test_id("start-assessment")

        if name == "empty":
            expect(start).to_be_disabled()
            assert page.locator(".m-assess-mode.is-unavailable").count() == 4
            assert not page.locator(".m-assess-catalog-state").count(), (
                "An empty pool must not claim a published usable scheme"
            )
            page.get_by_test_id("mode-rapid").click()
            expect(page.get_by_role("status")).to_contain_text("暂未开放")

        elif name == "missing_rapid":
            expect(start).to_be_enabled()
            before_url = page.url
            page.get_by_test_id("mode-rapid").click()
            expect(page.get_by_test_id("mode-rapid")).to_have_attribute("aria-pressed", "true")
            expect(start).to_be_disabled()
            expect(page.get_by_test_id("mode-rapid")).to_contain_text("暂未开放")
            assert page.url == before_url, "Selecting a mode must not navigate into a session"

        elif name == "timed":
            expect(start).to_be_disabled()
            timing = page.locator(".m-assess-timing")
            expect(timing).to_be_visible()
            expect(timing).to_contain_text("退出后继续计时")
            expect(timing).to_contain_text("不生成完整报告")
            checkbox = timing.locator("input")
            checkbox.check()
            expect(start).to_be_enabled()
            page.get_by_test_id("launch-blueprint").select_option("fixture-standard-enterprise")
            expect(checkbox).not_to_be_checked()
            expect(start).to_be_disabled()

        elif name == "synthetic":
            expect(start).to_be_enabled()
            assert page.locator(".m-assess-mode-state.is-synthetic").count() == 4
            origin = page.locator(".m-assess-origin")
            expect(origin).to_contain_text("非正式比赛题库")
            expect(origin).to_be_visible()
            assert not page.locator(".m-assess-rules").get_attribute("open"), (
                "Source disclosure must be visible even when detailed rules are folded"
            )

        elif name == "mixed":
            chooser = page.get_by_test_id("launch-blueprint")
            expect(chooser).to_have_value("fixture-standard-higher_education")
            chooser.select_option("fixture-synthetic-standard")
            expect(page.locator(".m-assess-origin")).to_contain_text("非正式比赛题库")
            expect(page.locator(".m-assess-origin")).to_be_visible()

        elif name == "failure":
            expect(page.get_by_role("alert")).to_contain_text("加载失败")
            assert not start.count(), "A failed catalog read must not expose an enabled start"
            page.screenshot(path=str(output / "boundary-failure-before-retry.png"))
            state["launch_error"] = False
            page.get_by_role("button", name="重新加载", exact=True).click()
            expect(start).to_be_enabled()

        elif name == "resume":
            expect(page.get_by_test_id("resume-session")).to_be_enabled()
            expect(start).to_have_text("继续此方案测评")

        else:
            raise AssertionError(f"Unknown test case: {name}")

        assert_read_only(state, errors, page, name)
        page.screenshot(path=str(output / f"boundary-{name}.png"))
        return {"case": name, "passed": True, "write_attempts": 0,
                "unexpected_requests": 0, "script_errors": 0, "horizontal_overflow": False}
    finally:
        context.close()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="http://127.0.0.1:5174",
                        help="Already-running mobile frontend URL; API requests stay fixture-only")
    parser.add_argument("--output", type=Path, default=Path("output/mobile-assessment-redesign"),
                        help="Directory for browser-only fixture screenshots")
    args = parser.parse_args()
    assert_business_script_preserved()
    args.output.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as playwright:
        chrome = Path(r"C:\Program Files\Google\Chrome\Application\chrome.exe")
        options = {"headless": True}
        if chrome.is_file():
            options["executable_path"] = str(chrome)
        browser = playwright.chromium.launch(**options)
        try:
            results = [check_case(browser, args.base_url, args.output, name, state)
                       for name, state in fixture_cases().items()]
        finally:
            browser.close()
    print(json.dumps({"business_script_preserved": True, "fixture_only": True,
                      "cases": results}, ensure_ascii=False))


if __name__ == "__main__":
    main()
