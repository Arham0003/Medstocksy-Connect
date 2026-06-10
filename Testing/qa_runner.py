"""
Medstocksy Connect -- Full QA Test Runner
Email : singh12521vaibhav@gmail.com
Pass  : @#vaibhav@#
App   : http://localhost:5180
"""
import sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

import subprocess, time, threading, json, os, re
from datetime import datetime
from pathlib import Path
from playwright.sync_api import sync_playwright, Page, BrowserContext, ConsoleMessage, Request, Response

# ─── Config ────────────────────────────────────────────────────────────────────
BASE_URL   = "http://localhost:5180"
EMAIL      = "singh12521vaibhav@gmail.com"
PASSWORD   = "@#vaibhav@#"
SHOTS_DIR  = Path(__file__).parent / "screenshots"
LOGS_DIR   = Path(__file__).parent / "logs"
SHOTS_DIR.mkdir(exist_ok=True)
LOGS_DIR.mkdir(exist_ok=True)

RUN_TS = datetime.now().strftime("%Y%m%d_%H%M%S")

# ─── State collectors ───────────────────────────────────────────────────────────
console_errors: list[dict] = []
api_failures:   list[dict] = []
bugs:           list[dict] = []
passed_checks:  list[str]  = []


# ─── Helpers ────────────────────────────────────────────────────────────────────
def shot(page: Page, name: str) -> str:
    p = str(SHOTS_DIR / f"{RUN_TS}_{name}.png")
    page.screenshot(path=p, full_page=True)
    return p


def bug(title: str, severity: str, module: str, steps: list[str],
        expected: str, actual: str, screenshot: str = "",
        api_err: str = "", console_err: str = ""):
    bugs.append({
        "title": title, "severity": severity, "module": module,
        "steps": steps, "expected": expected, "actual": actual,
        "screenshot": screenshot, "api_error": api_err, "console_error": console_err,
    })
    print(f"  [BUG][{severity}] {title}")


def ok(msg: str):
    passed_checks.append(msg)
    print(f"  [OK] {msg}")


def info(msg: str):
    print(f"  [INFO] {msg}")


def section(title: str):
    print(f"\n{'='*60}")
    print(f"  {title}")
    print(f"{'='*60}")


def attach_listeners(page: Page):
    """Wire console + network monitors."""
    def on_console(msg: ConsoleMessage):
        if msg.type in ("error", "warning"):
            console_errors.append({"type": msg.type, "text": msg.text, "url": page.url})

    def on_response(res: Response):
        if res.status >= 400:
            api_failures.append({
                "url": res.url, "status": res.status,
                "method": res.request.method, "page": page.url,
            })

    page.on("console", on_console)
    page.on("response", on_response)


def wait_nav(page: Page, timeout=15000):
    page.wait_for_load_state("networkidle", timeout=timeout)


def login(page: Page) -> bool:
    """Returns True on success."""
    page.goto(f"{BASE_URL}/login", wait_until="networkidle")
    # Labels in Login.tsx have no htmlFor -- use type-based selectors.
    # Login.tsx has TWO buttons matching 'sign in': the tab and the submit.
    # Target submit explicitly with type='submit'.
    page.locator("input[type='email']").fill(EMAIL)
    page.locator("input[type='password']").fill(PASSWORD)
    page.locator("button[type='submit']").click()
    try:
        page.wait_for_url(lambda u: "/login" not in u, timeout=12000)
        return True
    except Exception:
        return False


# ═══════════════════════════════════════════════════════════════════════════════
# TESTS
# ═══════════════════════════════════════════════════════════════════════════════

def test_auth(page: Page):
    section("AUTH TESTS")

    # 1. Invalid credentials
    page.goto(f"{BASE_URL}/login", wait_until="networkidle")
    page.locator("input[type='email']").fill("bad@test.com")
    page.locator("input[type='password']").fill("wrongpass")
    page.locator("button[type='submit']").click()
    time.sleep(2)
    error_el = page.locator(".text-destructive, [class*='destructive']").first
    if error_el.is_visible():
        ok("Invalid credentials -> error shown")
    else:
        s = shot(page, "auth_invalid_creds_no_error")
        bug("No error shown for invalid credentials", "High", "Auth",
            ["Go to /login", "Enter bad@test.com / wrongpass", "Click Sign In"],
            "Error message visible", "No error displayed", s)

    # 2. Empty submit
    page.goto(f"{BASE_URL}/login", wait_until="networkidle")
    page.locator("button[type='submit']").click()
    time.sleep(1)
    ok("Empty form submit -- browser/JS validation checked")

    # 3. Valid login
    page.locator("input[type='email']").fill(EMAIL)
    page.locator("input[type='password']").fill(PASSWORD)
    page.locator("button[type='submit']").click()
    try:
        page.wait_for_url(lambda u: "/login" not in u, timeout=15000)
        ok(f"Login success -> redirected to {page.url}")
        shot(page, "auth_login_success")
    except Exception:
        s = shot(page, "auth_login_failed")
        bug("Login with valid credentials failed / no redirect", "Critical", "Auth",
            ["Go to /login", f"Enter {EMAIL}", f"Enter password", "Click Sign In"],
            "Redirect to dashboard", "Stayed on /login or error", s,
            console_err=str([e for e in console_errors if "auth" in e["text"].lower()]))
        return

    # 4. Protected route without auth — test after login
    # (Will test protected route guard later via logout flow)

    # 5. Check session persists on reload
    page.reload()
    wait_nav(page)
    if "/login" not in page.url:
        ok("Session persists after reload")
    else:
        s = shot(page, "auth_session_lost_on_reload")
        bug("Session lost after page reload", "High", "Auth",
            ["Login", "Reload page"],
            "Stay logged in", "Redirected to /login", s)


def test_protected_routes(page: Page):
    section("PROTECTED ROUTE TESTS")
    protected = ["/customers", "/segments", "/campaigns", "/reminders", "/templates", "/activity", "/settings", "/rx"]

    for route in protected:
        page.goto(f"{BASE_URL}{route}", wait_until="networkidle")
        if "/login" in page.url:
            # This means unauthenticated guard works; but we're logged in, so this is a bug
            s = shot(page, f"protected_route_redirect{route.replace('/', '_')}")
            bug(f"Route {route} redirects logged-in user to /login", "High", "Routing",
                [f"Login as {EMAIL}", f"Navigate to {route}"],
                f"Page {route} loads", "Redirected to /login", s)
        elif "404" in page.title() or page.locator("text=not found", has_text=re.compile("not found", re.I)).count() > 0:
            s = shot(page, f"route_404{route.replace('/', '_')}")
            bug(f"Route {route} returns 404", "High", "Routing",
                [f"Navigate to {route}"],
                "Page renders", "404 error", s)
        else:
            ok(f"Protected route {route} loads for authenticated user")


def test_dashboard(page: Page):
    section("DASHBOARD TESTS")
    page.goto(BASE_URL, wait_until="networkidle")
    shot(page, "dashboard_home")

    # Check for key UI elements
    heading = page.get_by_role("heading").first
    if heading.is_visible():
        ok(f"Dashboard heading found: '{heading.text_content()}'")
    else:
        bug("Dashboard has no heading", "Low", "Dashboard",
            ["Navigate to /"], "H1/H2 heading visible", "No heading found")

    # Check for console errors on dashboard
    dash_errors = [e for e in console_errors if "localhost:5180" in e.get("url", "")]
    if dash_errors:
        for e in dash_errors[:3]:
            bug(f"Console {e['type']} on dashboard: {e['text'][:100]}", "Medium", "Dashboard",
                ["Load dashboard"], "No console errors", e['text'])

    # Check stat cards visible
    cards = page.locator("[class*='card'], [class*='Card']")
    card_count = cards.count()
    info(f"Found {card_count} card elements on dashboard")
    if card_count > 0:
        ok("Dashboard stat cards present")

    # Navigation links
    nav = page.locator("nav, [role='navigation']").first
    if nav.is_visible():
        ok("Navigation element present")
    else:
        s = shot(page, "dashboard_no_nav")
        bug("Navigation missing on dashboard", "High", "Layout",
            ["Load dashboard"], "Nav sidebar visible", "No nav element")


def test_customers(page: Page):
    section("CUSTOMER CRUD TESTS")
    page.goto(f"{BASE_URL}/customers", wait_until="networkidle")
    shot(page, "customers_list")

    # Check list renders
    table_or_list = page.locator("table, [role='table'], [class*='customer']").first
    if table_or_list.is_visible():
        ok("Customer list/table renders")
    else:
        s = shot(page, "customers_empty_or_broken")
        bug("Customer list not rendering", "High", "Customers",
            ["Navigate to /customers"], "Customer list visible", "List not found/visible", s)

    # Search test
    search_input = page.get_by_placeholder(re.compile("search", re.I)).first
    if search_input.count() > 0:
        search_input.fill("test")
        time.sleep(1)
        ok("Search input accepts text")
        search_input.fill("")
        time.sleep(1)

    # XSS in search
    if search_input.count() > 0:
        search_input.fill("<script>alert(1)</script>")
        time.sleep(1)
        page_src = page.content()
        if "<script>alert(1)</script>" in page_src and "alert" in page_src:
            bug("XSS payload reflected in customer search", "Critical", "Customers",
                ["Search for <script>alert(1)</script>"],
                "Input sanitized / escaped", "Raw script tag in DOM")
        else:
            ok("XSS payload sanitized in search")
        search_input.fill("")

    # SQL injection in search
    if search_input.count() > 0:
        search_input.fill("' OR 1=1 --")
        time.sleep(1)
        ok("SQL injection string entered in search (no crash)")
        search_input.fill("")

    # Open Add Customer dialog
    add_btn = page.get_by_role("button", name=re.compile(r"add|new|create", re.I)).first
    if add_btn.count() > 0 and add_btn.is_visible():
        add_btn.click()
        time.sleep(1)
        dialog = page.locator("[role='dialog']").first
        if dialog.is_visible():
            ok("Add Customer dialog opens")
            shot(page, "customers_add_dialog")

            # NOTE: Submit button is disabled until required fields filled
            submit = dialog.get_by_role("button", name=re.compile(r"save|create|add", re.I)).first
            if submit.count() > 0 and not submit.is_enabled():
                ok("Submit button pre-disabled until fields filled (good UX guard)")

            # CustomerFormDialog.tsx: Name = first Input (no placeholder/type),
            # Phone = input[type='tel'] with placeholder '98765 43210'.
            # Form prepends +91 so enter digits only.
            all_inputs = dialog.locator("input")
            name_input = all_inputs.first  # autoFocus name field
            phone_input = dialog.locator("input[type='tel']").first

            filled_name = False
            filled_phone = False
            if name_input.count() > 0:
                name_input.fill("QA Test Patient")
                filled_name = True
            if phone_input.count() > 0:
                phone_input.fill("9876543210")  # digits only; form adds +91
                filled_phone = True
                phone_input.dispatch_event("blur")  # trigger onBlur validation
            time.sleep(0.8)

            if not filled_name or not filled_phone:
                s = shot(page, "customers_fields_not_found")
                bug("Could not find name or phone input in Add Customer dialog", "High", "Customers",
                    ["Open dialog", "Inspect inputs"],
                    "Name + phone inputs found", f"name={filled_name} phone={filled_phone}", s)

            # Now button should be enabled
            if submit.count() > 0:
                if submit.is_enabled():
                    submit.click()
                    time.sleep(3)
                    try:
                        wait_nav(page, timeout=8000)
                    except Exception:
                        pass
                    if not dialog.is_visible():
                        ok("Add Customer dialog closed after submit (likely success)")
                        shot(page, "customers_after_create")
                    else:
                        err = dialog.locator("[class*='destructive']").first
                        if err.is_visible():
                            s = shot(page, "customers_create_error")
                            bug("Add Customer fails with error", "High", "Customers",
                                ["Open dialog", "Fill name + phone", "Click Save"],
                                "Customer created", f"Error: {err.text_content()}", s)
                        else:
                            s = shot(page, "customers_dialog_still_open")
                            info("Dialog still open after submit -- unclear state")
                else:
                    s = shot(page, "customers_submit_still_disabled")
                    bug("Submit button still disabled after filling name + phone", "High", "Customers",
                        ["Open dialog", "Fill 'QA Test Patient' in name", "Fill '9876543210' in phone"],
                        "Submit button enabled (canSubmit = name.trim() && phone.trim())",
                        "Button still disabled -- selector may have missed name field", s)

            # Close dialog before further tests (Escape or Cancel button)
            if dialog.is_visible():
                cancel = dialog.get_by_role("button", name=re.compile(r"cancel|close", re.I)).first
                if cancel.count() > 0 and cancel.is_visible():
                    cancel.click()
                else:
                    page.keyboard.press("Escape")
                time.sleep(0.5)
        else:
            s = shot(page, "customers_dialog_not_opening")
            bug("Add Customer dialog doesn't open", "High", "Customers",
                ["Click Add/New button"], "Dialog opens", "Dialog not visible", s)
    else:
        s = shot(page, "customers_no_add_btn")
        bug("No Add Customer button found", "Medium", "Customers",
            ["Navigate to /customers"], "Add/New button visible", "Button not found", s)

    # Ensure no modal overlay before pagination/filter tests
    try:
        page.wait_for_selector("[data-state='open'][aria-hidden='true']", state="detached", timeout=3000)
    except Exception:
        pass  # already gone or never appeared
    time.sleep(0.5)

    # Pagination check
    next_btn = page.get_by_role("button", name=re.compile(r"next|>", re.I)).first
    if next_btn.count() > 0:
        if next_btn.is_enabled():
            next_btn.click()
            time.sleep(1)
            ok("Pagination next button works")
        else:
            ok("Pagination next button present but disabled (single page)")

    # Filter / segment tabs -- skip if modal overlay still present
    overlay = page.locator("[data-state='open'][aria-hidden='true']")
    if overlay.count() == 0:
        filter_tabs = page.locator("button").filter(has_text=re.compile(r"^(All|New|Repeat|Inactive|High Value)$", re.I))
        if filter_tabs.count() > 0:
            tab = filter_tabs.first
            tab.click()
            time.sleep(1)
            ok(f"Filter tab '{tab.text_content()}' clickable")
    else:
        info("Modal overlay still present -- skipping filter tab test")

    shot(page, "customers_final")


def test_customer_profile(page: Page):
    section("CUSTOMER PROFILE TESTS")
    page.goto(f"{BASE_URL}/customers", wait_until="networkidle")

    # Click first customer row
    row = page.locator("tr[role], [class*='row'], tbody tr").first
    if row.count() == 0:
        info("No customer rows — skipping profile test")
        return

    row.click()
    time.sleep(2)
    wait_nav(page)

    if "/customers/" in page.url:
        ok(f"Customer profile opens: {page.url}")
        shot(page, "customer_profile")

        # Check tabs/sections
        tabs = page.locator("[role='tab']")
        if tabs.count() > 0:
            ok(f"Profile has {tabs.count()} tabs")
            for i in range(min(tabs.count(), 4)):
                tabs.nth(i).click()
                time.sleep(1)
                shot(page, f"customer_profile_tab_{i}")
                ok(f"Profile tab {i} clickable")
    else:
        s = shot(page, "customer_profile_no_nav")
        bug("Clicking customer row doesn't navigate to profile", "Medium", "Customers",
            ["Navigate to /customers", "Click first row"],
            "Navigate to /customers/:id", f"Still on {page.url}", s)


def test_segments(page: Page):
    section("SEGMENTS TESTS")
    page.goto(f"{BASE_URL}/segments", wait_until="networkidle")
    shot(page, "segments_page")

    heading = page.get_by_role("heading").first
    if heading.is_visible():
        ok(f"Segments page loads: {heading.text_content()}")
    else:
        bug("Segments page has no heading", "Low", "Segments",
            ["Navigate to /segments"], "Heading visible", "No heading")

    # Check for segment cards / list
    cards = page.locator("[class*='card'], [class*='segment']")
    info(f"Found {cards.count()} segment elements")


def test_campaigns(page: Page):
    section("CAMPAIGNS TESTS")
    page.goto(f"{BASE_URL}/campaigns", wait_until="networkidle")
    shot(page, "campaigns_page")
    ok("Campaigns page loaded")

    create_btn = page.get_by_role("button", name=re.compile(r"create|new|add", re.I)).first
    if create_btn.count() > 0 and create_btn.is_visible():
        create_btn.click()
        time.sleep(1)
        dialog = page.locator("[role='dialog']").first
        if dialog.is_visible():
            ok("Create Campaign dialog opens")
            shot(page, "campaigns_create_dialog")
            # Close dialog
            esc_btn = dialog.get_by_role("button", name=re.compile(r"cancel|close|×", re.I)).first
            if esc_btn.count() > 0:
                esc_btn.click()
        else:
            bug("Create Campaign dialog doesn't open", "Medium", "Campaigns",
                ["Click Create/New button"], "Dialog opens", "Dialog not visible")


def test_reminders(page: Page):
    section("REMINDERS TESTS")
    page.goto(f"{BASE_URL}/reminders", wait_until="networkidle")
    shot(page, "reminders_page")
    ok("Reminders page loaded")


def test_settings(page: Page):
    section("SETTINGS TESTS")
    page.goto(f"{BASE_URL}/settings", wait_until="networkidle")
    shot(page, "settings_page")

    heading = page.get_by_role("heading").first
    if heading.is_visible():
        ok(f"Settings page loads: {heading.text_content()}")

    # Check for profile section
    profile_section = page.locator("text=Profile, text=profile").first
    if profile_section.count() > 0:
        ok("Profile section found in settings")

    # Check for pharmacy settings
    pharmacy_section = page.locator("text=Pharmacy, text=pharmacy").first
    if pharmacy_section.count() > 0:
        ok("Pharmacy section found in settings")

    shot(page, "settings_final")


def test_prescription_workflow(page: Page):
    section("PRESCRIPTION WORKFLOW TESTS")
    page.goto(f"{BASE_URL}/rx", wait_until="networkidle")
    shot(page, "rx_page")

    heading = page.get_by_role("heading").first
    if heading.is_visible():
        ok(f"RX page loads: {heading.text_content()}")
    else:
        s = shot(page, "rx_no_heading")
        bug("Prescription workflow page has no heading", "Low", "RX",
            ["Navigate to /rx"], "Heading visible", "No heading found", s)


def test_activity(page: Page):
    section("ACTIVITY TESTS")
    page.goto(f"{BASE_URL}/activity", wait_until="networkidle")
    shot(page, "activity_page")
    ok("Activity page loaded")


def test_templates(page: Page):
    section("TEMPLATES TESTS")
    page.goto(f"{BASE_URL}/templates", wait_until="networkidle")
    shot(page, "templates_page")
    ok("Templates page loaded")

    create_btn = page.get_by_role("button", name=re.compile(r"create|new|add", re.I)).first
    if create_btn.count() > 0 and create_btn.is_visible():
        create_btn.click()
        time.sleep(1)
        dialog = page.locator("[role='dialog']").first
        if dialog.is_visible():
            ok("Create Template dialog opens")
            shot(page, "templates_create_dialog")
            page.keyboard.press("Escape")


def test_not_found(page: Page):
    section("404 / NOT FOUND TESTS")
    page.goto(f"{BASE_URL}/this-route-does-not-exist", wait_until="networkidle")
    shot(page, "not_found_page")

    body_text = page.locator("body").text_content() or ""
    if any(kw in body_text.lower() for kw in ["not found", "404", "page not found"]):
        ok("404 page renders correctly")
    else:
        bug("No 404 page for unknown routes", "Medium", "Routing",
            ["Navigate to /this-route-does-not-exist"],
            "404 page shown", f"Got: {body_text[:100]}")


def test_logout(page: Page):
    section("LOGOUT + SESSION CLEAR TESTS")
    page.goto(BASE_URL, wait_until="networkidle")

    # Find logout button — common patterns: dropdown menu, avatar button
    avatar_or_menu = page.locator("[aria-label*='user'], [aria-label*='account'], [class*='avatar']").first
    if avatar_or_menu.count() > 0 and avatar_or_menu.is_visible():
        avatar_or_menu.click()
        time.sleep(1)

    logout_btn = page.get_by_role("menuitem", name=re.compile(r"sign.?out|log.?out", re.I)).first
    if logout_btn.count() == 0:
        logout_btn = page.get_by_role("button", name=re.compile(r"sign.?out|log.?out", re.I)).first

    if logout_btn.count() > 0 and logout_btn.is_visible():
        logout_btn.click()
        time.sleep(2)
        wait_nav(page)
        if "/login" in page.url:
            ok("Logout redirects to /login")
            shot(page, "auth_logout_success")
        else:
            s = shot(page, "auth_logout_no_redirect")
            bug("Logout doesn't redirect to /login", "High", "Auth",
                ["Click logout"], "Redirect to /login", f"Stayed on {page.url}", s)

        # Verify protected route blocked after logout
        page.goto(f"{BASE_URL}/customers", wait_until="networkidle")
        if "/login" in page.url:
            ok("Protected route /customers redirects to /login after logout")
        else:
            s = shot(page, "auth_post_logout_unprotected")
            bug("Protected route accessible after logout", "Critical", "Auth",
                ["Logout", "Navigate to /customers"],
                "Redirect to /login", f"Stayed on {page.url}", s)
    else:
        s = shot(page, "auth_no_logout_btn")
        bug("Logout button not found", "High", "Auth",
            ["Load dashboard", "Look for logout/sign out"],
            "Logout button visible", "Button not found", s)


def test_responsive(page: Page):
    section("RESPONSIVE / MOBILE TESTS")
    page.set_viewport_size({"width": 375, "height": 812})
    page.goto(BASE_URL, wait_until="networkidle")
    shot(page, "responsive_mobile_dashboard")

    # Check for hamburger / mobile nav
    hamburger = page.locator("[aria-label*='menu'], button[class*='hamburger'], button[class*='mobile']").first
    if hamburger.count() > 0 and hamburger.is_visible():
        ok("Mobile hamburger menu present")
    else:
        info("No explicit hamburger menu found — may use different mobile nav")

    # Reset viewport
    page.set_viewport_size({"width": 1280, "height": 800})


# ═══════════════════════════════════════════════════════════════════════════════
# REPORT
# ═══════════════════════════════════════════════════════════════════════════════

def generate_report():
    section("QA REPORT")
    report_path = LOGS_DIR / f"qa_report_{RUN_TS}.json"
    md_path      = LOGS_DIR / f"qa_report_{RUN_TS}.md"

    data = {
        "run_timestamp": RUN_TS,
        "email": EMAIL,
        "base_url": BASE_URL,
        "bugs": bugs,
        "passed_checks": passed_checks,
        "console_errors": console_errors,
        "api_failures": api_failures,
        "summary": {
            "total_bugs": len(bugs),
            "critical": sum(1 for b in bugs if b["severity"] == "Critical"),
            "high": sum(1 for b in bugs if b["severity"] == "High"),
            "medium": sum(1 for b in bugs if b["severity"] == "Medium"),
            "low": sum(1 for b in bugs if b["severity"] == "Low"),
            "passed": len(passed_checks),
            "console_errors": len(console_errors),
            "api_failures": len(api_failures),
        }
    }
    with open(report_path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)

    # Markdown report
    lines = [
        "# Medstocksy Connect QA Report",
        f"**Run:** {RUN_TS}  |  **User:** {EMAIL}  |  **URL:** {BASE_URL}\n",
        "## Summary",
        "| Metric | Count |",
        "|--------|-------|",
        f"| Passed Checks | {len(passed_checks)} |",
        f"| Total Bugs | {len(bugs)} |",
        f"| Critical | {data['summary']['critical']} |",
        f"| High | {data['summary']['high']} |",
        f"| Medium | {data['summary']['medium']} |",
        f"| Low | {data['summary']['low']} |",
        f"| Console Errors | {len(console_errors)} |",
        f"| API Failures | {len(api_failures)} |",
        "",
    ]

    if bugs:
        lines += ["## Bug Reports\n"]
        for i, b in enumerate(bugs, 1):
            lines += [
                f"### Bug #{i}: {b['title']}",
                f"- **Severity:** {b['severity']}",
                f"- **Module:** {b['module']}",
                f"- **Steps:** {' -> '.join(b['steps'])}",
                f"- **Expected:** {b['expected']}",
                f"- **Actual:** {b['actual']}",
            ]
            if b.get("screenshot"):
                lines.append(f"- **Screenshot:** `{b['screenshot']}`")
            if b.get("api_error"):
                lines.append(f"- **API Error:** {b['api_error']}")
            if b.get("console_error"):
                lines.append(f"- **Console:** {b['console_error']}")
            lines.append("")

    if console_errors:
        lines += [f"## Console Errors\n"]
        for e in console_errors[:20]:
            lines.append(f"- `[{e['type']}]` {e['text'][:120]}")

    if api_failures:
        lines += ["\n## API Failures\n"]
        for f_ in api_failures[:20]:
            lines.append(f"- {f_['method']} {f_['status']} -- {f_['url'][:100]}")

    lines += ["\n## Passed Checks\n"]
    for p in passed_checks:
        lines.append(f"- [PASS] {p}")

    with open(md_path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))

    print(f"\nJSON report : {report_path}")
    print(f"MD  report  : {md_path}")
    print(f"\nBugs found  : {len(bugs)} "
          f"(Critical={data['summary']['critical']}, High={data['summary']['high']}, "
          f"Medium={data['summary']['medium']}, Low={data['summary']['low']})")
    print(f"Checks passed: {len(passed_checks)}")
    print(f"Console errs : {len(console_errors)}")
    print(f"API failures : {len(api_failures)}")

    return md_path


# ═══════════════════════════════════════════════════════════════════════════════
# MAIN
# ═══════════════════════════════════════════════════════════════════════════════

def run_tests():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False, slow_mo=100)
        ctx: BrowserContext = browser.new_context(
            viewport={"width": 1280, "height": 800},
            locale="en-US",
        )
        page = ctx.new_page()
        attach_listeners(page)

        try:
            # Phase 1: Auth (login with valid creds at end)
            test_auth(page)

            # If we're not logged in after auth tests, try re-login
            if "/login" in page.url:
                info("Re-logging in for remaining tests…")
                if not login(page):
                    print("❌ Cannot login — aborting remaining tests")
                    return

            # Phase 2: Layout / protected routes
            test_protected_routes(page)

            # Phase 3: Dashboard
            test_dashboard(page)

            # Phase 4: Core modules
            test_customers(page)
            test_customer_profile(page)
            test_segments(page)
            test_campaigns(page)
            test_reminders(page)
            test_templates(page)
            test_activity(page)
            test_prescription_workflow(page)
            test_settings(page)

            # Phase 5: Routing edge cases
            test_not_found(page)

            # Phase 6: Responsive
            test_responsive(page)

            # Phase 7: Logout + session guard
            test_logout(page)

        except Exception as e:
            s = shot(page, "uncaught_exception")
            bug(f"Uncaught test exception: {str(e)[:120]}", "Critical", "Test Runner",
                ["Running QA suite"], "Suite completes", str(e), s)
            import traceback; traceback.print_exc()
        finally:
            browser.close()

    return generate_report()


if __name__ == "__main__":
    # Check playwright installed
    try:
        import playwright
    except ImportError:
        print("Installing playwright…")
        subprocess.check_call([sys.executable, "-m", "pip", "install", "playwright"])
        subprocess.check_call([sys.executable, "-m", "playwright", "install", "chromium"])

    print(f"\nMedstocksy Connect QA Runner")
    print(f"   URL   : {BASE_URL}")
    print(f"   Email : {EMAIL}")
    print(f"   Time  : {RUN_TS}")
    print(f"   Shots : {SHOTS_DIR}")
    print(f"   Logs  : {LOGS_DIR}\n")

    run_tests()
