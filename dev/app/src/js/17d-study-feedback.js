/* Shared student guidance. It only reads sync/profile state; question writes stay in DataCore. */
function studyFeedbackModel(reset = "") {
  if (reset)
    return {
      kind: "filtered",
      title: tx("No questions match", "कोई सवाल मेल नहीं खाता"),
      detail: tx(
        "Clear the filters or choose another exam.",
        "फ़िल्टर हटाएँ या दूसरी परीक्षा चुनें।",
      ),
      action: reset,
      label: tx("Clear filters", "फ़िल्टर हटाएँ"),
    };
  if (CloudState.busy)
    return {
      kind: "loading",
      title: tx("Loading your questions…", "आपके सवाल लाए जा रहे हैं…"),
      detail: tx(
        "Your saved questions and progress stay on this device.",
        "सहेजे गए सवाल और प्रगति इस डिवाइस पर सुरक्षित हैं।",
      ),
    };
  if (navigator.onLine === false)
    return {
      kind: "offline",
      title: tx("You are offline", "आप ऑफ़लाइन हैं"),
      detail: tx(
        "Connect to sync questions. Previously downloaded questions remain available.",
        "सवाल सिंक करने के लिए इंटरनेट चालू करें। पहले डाउनलोड किए सवाल उपलब्ध रहेंगे।",
      ),
    };
  if (!ServerState.session)
    return {
      kind: "guest",
      title: tx(
        "Sign in to get your questions",
        "अपने सवाल पाने के लिए लॉगिन करें",
      ),
      detail: tx(
        "Guest mode uses questions saved on this device. Sign in to download published questions and sync progress.",
        "मेहमान मोड में इस डिवाइस के सवाल दिखते हैं। प्रकाशित सवाल और प्रगति सिंक करने के लिए लॉगिन करें।",
      ),
      action: "login",
      label: tx("Sign in", "लॉगिन करें"),
    };
  if (["bad", "warn"].includes(CloudState.msgKind))
    return {
      kind: "error",
      title: tx("Questions could not sync", "सवाल सिंक नहीं हो सके"),
      detail: tx(
        "Your saved questions and progress are still available. Try syncing again.",
        "सहेजे गए सवाल और प्रगति उपलब्ध हैं। फिर से सिंक करें।",
      ),
      action: "sync",
      label: tx("Retry sync", "फिर सिंक करें"),
    };
  if (!CloudState.lastContentAt)
    return {
      kind: "pending",
      title: tx("Download your questions", "अपने सवाल डाउनलोड करें"),
      detail: tx(
        "Sync to check for published questions for your exam.",
        "अपनी परीक्षा के प्रकाशित सवाल देखने के लिए सिंक करें।",
      ),
      action: "sync",
      label: tx("Sync questions", "सवाल सिंक करें"),
    };
  return {
    kind: "empty",
    title: tx(
      "No questions available here yet",
      "यहाँ अभी सवाल उपलब्ध नहीं हैं",
    ),
    detail: tx(
      "Try another exam or branch. Only published questions are available to students.",
      "दूसरी परीक्षा या ब्रांच चुनें। विद्यार्थियों को सिर्फ़ प्रकाशित सवाल मिलते हैं।",
    ),
    action: "context",
    label: tx("Change exam", "परीक्षा बदलें"),
  };
}
function studyFeedbackBody(reset) {
  const model = studyFeedbackModel(reset);
  return `<div class="study-feedback" data-state="${model.kind}" role="status" aria-live="polite" aria-busy="${model.kind === "loading"}">
    <strong>${escapeHtml(model.title)}</strong><p>${escapeHtml(model.detail)}</p>
    ${model.action ? `<button type="button" class="study-action" onclick="studyFeedbackAction('${model.action}')" ${DataHealth.readOnly && model.action === "sync" ? "disabled" : ""}>${escapeHtml(model.label)}</button>` : ""}
  </div>`;
}
function studyEmptyState(reset = "") {
  return `<div data-study-feedback="${escapeHtml(reset)}">${studyFeedbackBody(reset)}</div>`;
}
function studyFeedbackAction(action) {
  if (action === "login") openAccount();
  else if (action === "sync") cloudSync("manual");
  else if (action === "bank") qbClear();
  else if (action === "subject") shSetFilter("all");
  else if (action === "context") changeStudyContext();
}
function studySyncLabel() {
  if (CloudState.busy) return tx("Syncing…", "सिंक हो रहा है…");
  if (navigator.onLine === false)
    return tx(
      "Offline · saved questions available",
      "ऑफ़लाइन · सहेजे गए सवाल उपलब्ध हैं",
    );
  if (!ServerState.session)
    return tx(
      "Guest · progress on this device",
      "मेहमान · प्रगति इस डिवाइस पर है",
    );
  if (["bad", "warn"].includes(CloudState.msgKind))
    return tx(
      "Sync failed · retry from Me",
      "सिंक नहीं हुआ · मैं पेज से फिर कोशिश करें",
    );
  return CloudState.lastSyncAt
    ? tx(
        "Synced · saved questions available offline",
        "सिंक पूरा · सहेजे गए सवाल ऑफ़लाइन उपलब्ध हैं",
      )
    : tx("Questions not synced yet", "सवाल अभी सिंक नहीं हुए हैं");
}
function refreshStudyFeedback() {
  document.querySelectorAll("[data-study-feedback]").forEach((el) => {
    el.innerHTML = studyFeedbackBody(el.dataset.studyFeedback);
  });
  document.querySelectorAll("[data-study-sync]").forEach((el) => {
    el.textContent = studySyncLabel();
  });
}
function changeStudyContext() {
  if (Route.page === "native_builder") {
    sbOpenContextPicker();
    return;
  }
  if (profileAvailable()) openProfileSheet();
  else navigate("exam_hub");
}
function studyContextHtml() {
  const profile = studentProfile();
  let examId = profile?.examId || UserState.selectedExam || "";
  let year =
    examId === UserState.selectedExam ? UserState.selectedYear || "" : "";
  if (Route.page === "native_builder" && SB.inited && SB.mode) {
    if (SB.mode === "quick") [examId, year] = sbQuickContextKey().split(SB_SEP);
    else if (SB.mode === "pyq") {
      examId = SB.pyqExam;
      year = SB.pyqYear;
    } else {
      examId = SB.examId;
      year = SB.year;
    }
  } else if (
    Route.page === "taxonomy_explorer" &&
    ActiveTaxonomyFilters.examId
  ) {
    examId = ActiveTaxonomyFilters.examId;
    if (examId !== UserState.selectedExam) year = "";
  }
  const exam =
    CloudState.profileIndex?.[examId]?.name ||
    UniversalExamRegistry.registry.get(examId)?.examName ||
    UniversalExamRegistry.knownProfiles[examId]?.name ||
    examId;
  const branch =
    profile?.examId === examId && profile.branch
      ? tx(
          ProfileRules.branchLabel(profile.branch),
          ProfileRules.branchHi(profile.branch),
        )
      : "";
  const label =
    [exam, branch, year].filter(Boolean).join(" · ") ||
    tx("All available exams", "सभी उपलब्ध परीक्षाएँ");
  const loaded =
    profile && profile.examId !== examId
      ? `<small>${escapeHtml(tx("Downloaded profile: ", "डाउनलोड किया प्रोफ़ाइल: ") + profileLabel(profile))}</small>`
      : "";
  return `<aside class="study-context" aria-label="${tx("Study context", "पढ़ाई का संदर्भ")}">
    <div class="study-context-copy"><strong>${escapeHtml((Route.page === "native_builder" ? tx("Selection: ", "चयन: ") : tx("Profile: ", "प्रोफ़ाइल: ")) + label)}</strong>${loaded}<small data-study-sync role="status" aria-live="polite">${escapeHtml(studySyncLabel())}</small></div>
    <button type="button" class="study-action" onclick="changeStudyContext()" aria-label="${tx("Change exam", "परीक्षा बदलें")}">${tx("Change", "बदलें")}</button>
  </aside>`;
}
registerViewHook("after", "study-context", () => {
  if (WorkspaceManager.current().type !== "COMPETITIVE") return;
  if (
    ![
      "subjects",
      "subject",
      "chapter",
      "topic",
      "subtopic",
      "taxonomy_explorer",
      "native_builder",
      "test_hub",
      "pyq_hub",
    ].includes(Route.page)
  )
    return;
  const view = document.getElementById("mainView");
  if (Route.page === "native_builder")
    view
      .querySelector(".sb-top")
      ?.insertAdjacentHTML("afterend", studyContextHtml());
  else view.insertAdjacentHTML("afterbegin", studyContextHtml());
});
window.addEventListener("online", refreshStudyFeedback);
window.addEventListener("offline", refreshStudyFeedback);
