"""Mobile layout and settings accessibility. Usage: test_mobile_design.py APP OUT."""

import json
import sys
from playwright.sync_api import sync_playwright

app, out = sys.argv[1:3]
results = []


def rec(name, ok, detail=""):
    results.append((name, "PASS" if ok else "FAIL", str(detail)[:240]))
    print("PASS" if ok else "FAIL", name, detail, flush=True)


with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": 360, "height": 800})
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.route("https://**/*", lambda route: route.abort())
    page.goto("file://" + app)
    page.wait_for_selector(".sj-dash")
    rec(
        "Continue and daily goal precede study shortcuts in reading order",
        page.evaluate("""() => {
      const cards = [...document.querySelector('.gx').children];
      return cards.indexOf(document.querySelector('.gx-continue')) < cards.indexOf(document.querySelector('.gx-goal')) &&
        cards.indexOf(document.querySelector('.gx-goal')) < cards.indexOf(document.querySelector('.gx-quick'));
    }"""),
    )
    rec(
        "Fresh session has one main study action instead of an empty Continue message",
        page.locator(".gx-continue .gx-btn").count() == 1
        and "No unfinished activity" not in page.locator(".gx-continue").inner_text(),
    )
    page.evaluate("navigate('subjects')")
    page.locator(".sn-tab").first.focus()
    page.keyboard.press("Enter")
    rec(
        "Subject selection keeps keyboard focus on the selected subject",
        page.evaluate("document.activeElement.matches('.sn-tab[aria-pressed=true]')"),
    )
    page.locator(".sn-chapter-toggle").first.focus()
    page.keyboard.press("Enter")
    rec(
        "Expanding a chapter keeps keyboard focus on its toggle",
        page.evaluate(
            "document.activeElement.matches('.sn-chapter-toggle[aria-expanded=true]')"
        ),
    )
    topic = page.locator(".sn-chapter.open .sn-topic").first
    target = topic.get_attribute("onclick")
    topic.click()
    rec(
        "Topic selection opens the selected topic, not its chapter",
        page.evaluate("Route.page === 'topic'")
        and page.evaluate("Route.params.moduleId") in target,
    )
    page.evaluate("appNavigateBack()")
    rec(
        "Back restores expanded Subjects chapter",
        page.locator(".sn-chapter.open .sn-topic").count() > 0,
    )
    page.locator(".sn-chapter-action button").first.click()
    rec(
        "Open chapter still opens the whole chapter",
        page.evaluate("Route.page === 'chapter'"),
    )
    page.evaluate("navigate('home')")
    rec(
        "Home identifies guest and local-only progress",
        "Guest" in page.locator("[data-study-sync]").inner_text(),
    )
    page.evaluate("navigate('me')")
    rec(
        "Me identifies guest and local-only progress",
        "Guest" in page.locator("[data-study-sync]").inner_text(),
    )
    page.evaluate(
        "ServerState.session={user_id:'test',email:'test@example.invalid'};CloudState.lastSyncAt='2026-10-19T00:00:00Z';refreshStudyFeedback()"
    )
    rec(
        "Me reports a completed sync",
        "Synced" in page.locator("[data-study-sync]").inner_text(),
    )
    page.evaluate("CloudState.busy=true;refreshStudyFeedback()")
    rec(
        "Me updates while syncing",
        "Syncing" in page.locator("[data-study-sync]").inner_text(),
    )
    page.evaluate(
        "CloudState.busy=false;CloudState.msgKind='bad';refreshStudyFeedback()"
    )
    rec(
        "Me reports sync failure instead of stale success",
        "Sync failed" in page.locator("[data-study-sync]").inner_text(),
    )
    page.evaluate(
        "ServerState.session=null;CloudState.msgKind='';CloudState.lastSyncAt=''"
    )
    page.evaluate("navigate('home')")
    page.click("#btnMenu")
    page.click("#drwMe")
    page.locator("#btnTextSize").focus()
    page.keyboard.press("Enter")
    rec(
        "Display remains keyboard accessible through Me",
        page.locator("#modalSheet.open").count() == 1,
    )
    page.keyboard.press("Escape")
    rec(
        "Display restores focus to its visible settings control",
        page.evaluate("document.activeElement.id === 'btnTextSize'"),
    )
    # Closing within the same event turn must cancel the pending autofocus.
    page.evaluate("""() => {
      document.getElementById('btnTextSize').focus();
      openDisplaySettings();
      closeModal();
    }""")
    page.wait_for_timeout(50)
    rec(
        "Rapidly closed Display never steals focus back into the closed dialog",
        page.evaluate(
            "!nbModalIsOpen() && document.activeElement.id === 'btnTextSize'"
        ),
    )
    page.locator(".me-row", has_text="Dark mode").click()
    rec(
        "Me theme control changes and persists theme",
        page.evaluate(
            "UserState.theme === 'dark' && document.body.classList.contains('dark')"
        ),
    )
    page.evaluate("StorageWriteQueue.flush()")
    page.reload()
    page.wait_for_selector(".me-head")
    rec(
        "Theme survives reload",
        page.evaluate(
            "UserState.theme === 'dark' && document.body.classList.contains('dark')"
        ),
    )
    for width in [360, 412, 768, 1280]:
        page.set_viewport_size({"width": width, "height": 900})
        for lang in ["en", "hi"]:
            for size in ["m", "xl"]:
                for dark in [False, True]:
                    page.evaluate(
                        """([lang,size,dark]) => {
                      StudySettings.ui={lang,size}; UserState.theme=dark?'dark':'light';
                      document.body.classList.toggle('dark',dark);applyDisplaySettings();navigate('subjects');
                    }""",
                        [lang, size, dark],
                    )
                    page.wait_for_timeout(35)
                    issues = page.evaluate("""() => {
                      const issues=[];const main=document.getElementById('mainView');
                      if(main.scrollWidth>main.clientWidth+1 || document.documentElement.scrollWidth>innerWidth+1) issues.push('overflow');
                      const title=document.getElementById('txtHeaderTitle');
                      if(title.scrollWidth>title.clientWidth+1) issues.push('title clipped');
                      for(const button of document.querySelectorAll('#appHeader button,.study-context button')) {
                        if(!button.getClientRects().length) continue;
                        const r=button.getBoundingClientRect();
                        if(r.width<44 || r.height<44) issues.push('small target');
                      }
                      if(document.querySelector('.study-context').getBoundingClientRect().height>155) issues.push('context too tall');
                      return issues;
                    }""")
                    rec(
                        f'Subjects {width}px {lang} {size} {"dark" if dark else "light"}',
                        not issues,
                        issues,
                    )
    page.evaluate(
        "StudySettings.ui={lang:'hi',size:'m'};applyDisplaySettings();navigate('native_builder');sbStartMode('custom')"
    )
    rec(
        "Hindi exam selection gives Hindi guidance",
        "आगे बढ़ने" in page.locator(".sb-shell").inner_text()
        or "चुनें" in page.locator(".sb-shell").inner_text(),
    )
    page.evaluate("SB.step='settings';sbRerender(false)")
    rec(
        "Hindi settings labels and fallback guidance",
        "सवालों की संख्या" in page.locator(".sb-body").inner_text()
        and "Number of questions" not in page.locator(".sb-body").inner_text(),
    )
    rec("No runtime errors in the layout/settings journey", not errors, errors)
    browser.close()

with open(out, "w") as handle:
    json.dump(results, handle, ensure_ascii=False)
sys.exit(any(item[1] == "FAIL" for item in results))
