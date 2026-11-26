
/* ===== VENTURE INFO anonymous analytics ===== */
const ANALYTICS_CONFIG = {
  supabaseUrl: "https://ioznepuggdzagmckljbp.supabase.co",
  publishableKey: "sb_publishable_JAPUbLW_UTupYjKxmWFCXg_NicyJxn5"
};

const ANALYTICS_SESSION_KEY = "vi-analytics-session-v1";
const ONBOARDING_KEY = "vi-onboarding-complete-v1";
const PREFERENCE_KEY = "vi-preference-profile-v1";

function makeAnalyticsSessionId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return `vi-${Date.now()}-${Math.random().toString(16).slice(2)}-${Math.random().toString(16).slice(2)}`;
}

const analyticsSessionId =
  localStorage.getItem(ANALYTICS_SESSION_KEY) || makeAnalyticsSessionId();

localStorage.setItem(ANALYTICS_SESSION_KEY, analyticsSessionId);

let analyticsQueue = [];
let analyticsFlushTimer = null;
let analyticsFailures = 0;
let analyticsRetryAt = 0;
let analyticsLastDigAt = 0;
const ANALYTICS_BATCH_SIZE = 40;
const ANALYTICS_FLUSH_MS = 6000;
const ANALYTICS_MAX_QUEUE = 200;
const ANALYTICS_DIG_INTERVAL_MS = 350;

function analyticsReady() {
  return /^https:\/\/.+\.supabase\.co\/?$/.test(ANALYTICS_CONFIG.supabaseUrl) &&
    ANALYTICS_CONFIG.publishableKey.startsWith("sb_publishable_");
}

async function analyticsPost(table, rows, keepalive = false) {
  if (!analyticsReady() || !rows.length) return false;

  const base = ANALYTICS_CONFIG.supabaseUrl.replace(/\/$/, "");

  try {
    const response = await fetch(`${base}/rest/v1/${table}`, {
      method: "POST",
      headers: {
        "apikey": ANALYTICS_CONFIG.publishableKey,
        "Authorization": `Bearer ${ANALYTICS_CONFIG.publishableKey}`,
        "Content-Type": "application/json",
        "Prefer": "return=minimal"
      },
      body: JSON.stringify(rows),
      keepalive
    });

    if (!response.ok) {
      console.warn("VENTURE INFO analytics insert failed:", response.status, await response.text());
      return false;
    }
    return true;
  } catch (error) {
    console.warn("VENTURE INFO analytics network error:", error);
    return false;
  }
}

function analyticsTrack(eventType, payload = {}) {
  if (eventType === "dig") {
    // 1回のドラッグで大量のdigが出るため、一定間隔ごとに1件だけ記録する
    const now = Date.now();
    if (now - analyticsLastDigAt < ANALYTICS_DIG_INTERVAL_MS) return;
    analyticsLastDigAt = now;
  }
  analyticsQueue.push({
    session_id: analyticsSessionId,
    event_type: eventType,
    industry: payload.industry || null,
    company: payload.company || null,
    x_position: Number.isFinite(payload.x_position)
      ? Number(payload.x_position.toFixed(4))
      : null,
    depth_m: Number.isFinite(payload.depth_m)
      ? Math.round(payload.depth_m)
      : null,
    metadata: payload.metadata || {}
  });

  if (analyticsQueue.length > ANALYTICS_MAX_QUEUE) {
    analyticsQueue.splice(0, analyticsQueue.length - ANALYTICS_MAX_QUEUE);
  }

  const backingOff = Date.now() < analyticsRetryAt;
  if (analyticsQueue.length >= ANALYTICS_BATCH_SIZE && !backingOff) {
    analyticsFlush();
  } else if (!analyticsFlushTimer) {
    const wait = Math.max(ANALYTICS_FLUSH_MS, analyticsRetryAt - Date.now());
    analyticsFlushTimer = setTimeout(() => analyticsFlush(), wait);
  }
}

async function analyticsFlush(keepalive = false) {
  clearTimeout(analyticsFlushTimer);
  analyticsFlushTimer = null;

  if (!analyticsQueue.length || !analyticsReady()) return;

  if (!keepalive && Date.now() < analyticsRetryAt) {
    analyticsFlushTimer = setTimeout(() => analyticsFlush(), analyticsRetryAt - Date.now());
    return;
  }

  const batch = analyticsQueue.splice(0, analyticsQueue.length);
  const ok = await analyticsPost("events", batch, keepalive);

  if (ok) {
    analyticsFailures = 0;
    analyticsRetryAt = 0;
    return;
  }
  if (!keepalive) {
    // 失敗時は間隔を倍々に空けて再送（最大60秒）
    analyticsFailures += 1;
    analyticsRetryAt = Date.now() + Math.min(60000, 5000 * 2 ** (analyticsFailures - 1));
    analyticsQueue.unshift(...batch.slice(-ANALYTICS_MAX_QUEUE));
    if (analyticsQueue.length > ANALYTICS_MAX_QUEUE) {
      analyticsQueue.splice(0, analyticsQueue.length - ANALYTICS_MAX_QUEUE);
    }
    if (!analyticsFlushTimer) {
      analyticsFlushTimer = setTimeout(() => analyticsFlush(), analyticsRetryAt - Date.now());
    }
  }
}

function setupOnboardingSurvey() {
  const dialog = document.getElementById("onboardingDialog");
  const form = document.getElementById("onboardingForm");
  if (!dialog || !form) return;
  const choices = {
    occupation: ["高校生", "大学生", "大学院生", "専門学校生", "社会人", "その他"],
    priority: ["給与", "仕事内容", "働き方", "福利厚生", "企業の安定性", "成長環境"]
  };
  const selected = { occupation: 0, priority: 0 };
  let stage = "occupation";
  function paintWheel(kind, position) {
    const track = document.getElementById(`${kind}Track`);
    const viewport = document.getElementById(`${kind}Viewport`);
    const radius = Math.min(185, Math.max(130, viewport.clientWidth * .55));
    const count = choices[kind].length;
    [...track.children].forEach((item, i) => {
      let distance = i - position;
      if (distance > count / 2) distance -= count;
      if (distance < -count / 2) distance += count;
      const angle = distance * Math.PI / 3;
      const depth = Math.abs(distance);
      const x = Math.sin(angle) * radius;
      const y = (1 - Math.cos(angle)) * 17;
      const z = (Math.cos(angle) - 1) * 115;
      const yaw = -Math.sin(angle) * 35;
      const tilt = -Math.sin(angle) * 7;
      const scale = Math.max(.63, 1 - depth * .085);
      item.style.setProperty("--wheel-transform",
        `translate(-50%, -50%) translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, ${z.toFixed(1)}px) rotateY(${yaw.toFixed(1)}deg) rotateZ(${tilt.toFixed(1)}deg) scale(${scale.toFixed(3)})`);
      item.style.setProperty("--wheel-opacity", String(Math.max(.1, 1 - depth * .33)));
      item.style.zIndex = String(100 - Math.round(depth * 10));
      item.style.pointerEvents = depth < 1.5 ? "auto" : "none";
    });
  }
  function select(kind, index) {
    const track = document.getElementById(`${kind}Track`);
    const count = choices[kind].length;
    selected[kind] = ((index % count) + count) % count;
    paintWheel(kind, selected[kind]);
    [...track.children].forEach((item, i) => {
      item.classList.toggle("current", i === selected[kind]);
      item.setAttribute("aria-pressed", String(i === selected[kind]));
    });
    document.getElementById(`${kind}Selection`).textContent = choices[kind][selected[kind]];
  }
  const shovelArt = '<img class="shovel-illustration" src="preference-shovel.svg" alt="" draggable="false">';
  for (const kind of ["occupation", "priority"]) {
    const track = document.getElementById(`${kind}Track`);
    const viewport = document.getElementById(`${kind}Viewport`);
    track.innerHTML = choices[kind].map((name, i) => `<button class="preference-card ${kind === "occupation" ? "shovel" : "preference-ore"}" type="button" aria-pressed="${i === 0}"><span class="preference-figure">${kind === "occupation" ? shovelArt : ""}<span class="preference-label">${name}</span></span></button>`).join("");
    let suppressClick = false;
    track.addEventListener("click", event => {
      if (suppressClick) { event.preventDefault(); event.stopPropagation(); suppressClick = false; }
    }, true);
    [...track.children].forEach((card, i) => card.addEventListener("click", () => select(kind, i)));
    let origin = null;
    let dragging = false;
    viewport.addEventListener("pointerdown", event => {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      origin = event.clientX;
      suppressClick = false;
    });
    viewport.addEventListener("pointermove", event => {
      if (origin === null || Math.abs(event.clientX - origin) < 5 && !dragging) return;
      if (!dragging) {
        dragging = true;
        viewport.classList.add("dragging");
        viewport.setPointerCapture?.(event.pointerId);
      }
      const turns = Math.max(-1.4, Math.min(1.4,
        (origin - event.clientX) / Math.max(120, viewport.clientWidth * .33)));
      paintWheel(kind, selected[kind] + turns);
    });
    viewport.addEventListener("pointerup", event => {
      if (origin === null) return;
      const delta = event.clientX - origin;
      origin = null;
      viewport.classList.remove("dragging");
      if (dragging && viewport.hasPointerCapture?.(event.pointerId)) viewport.releasePointerCapture(event.pointerId);
      dragging = false;
      if (Math.abs(delta) > 32) { suppressClick = true; select(kind, selected[kind] + (delta < 0 ? 1 : -1)); }
      else select(kind, selected[kind]);
    });
    viewport.addEventListener("pointercancel", () => {
      origin = null;
      dragging = false;
      viewport.classList.remove("dragging");
      select(kind, selected[kind]);
    });
    viewport.addEventListener("keydown", event => {
      if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
        event.preventDefault(); select(kind, selected[kind] + (event.key === "ArrowRight" ? 1 : -1));
        track.children[selected[kind]].focus();
      }
    });
  }
  document.querySelectorAll("[data-carousel]").forEach(button => button.addEventListener("click", () => {
    const kind = button.dataset.carousel;
    select(kind, selected[kind] + Number(button.dataset.direction));
  }));
  const back = document.getElementById("preferenceBack");
  const next = document.getElementById("preferenceNext");
  function showStage(kind) {
    stage = kind;
    document.getElementById("occupationStage").hidden = kind !== "occupation";
    document.getElementById("priorityStage").hidden = kind !== "priority";
    document.getElementById("preferenceStep").textContent = kind === "occupation" ? "STEP 01 · PROFILE" : "STEP 02 · PRIORITY";
    document.getElementById("preferenceProgress2").classList.toggle("done", kind === "priority");
    back.hidden = kind === "occupation";
    next.textContent = kind === "occupation" ? "次へ" : "採掘をはじめる";
    requestAnimationFrame(() => select(kind, selected[kind]));
  }
  back.addEventListener("click", () => showStage("occupation"));
  dialog.addEventListener("cancel", event => event.preventDefault());
  dialog.addEventListener("preference-open", () => requestAnimationFrame(() => select(stage, selected[stage])));
  form.addEventListener("submit", event => {
    event.preventDefault();
    if (stage === "occupation") { showStage("priority"); return; }
    const occupation = choices.occupation[selected.occupation];
    const priority = choices.priority[selected.priority];
    localStorage.setItem(PREFERENCE_KEY, JSON.stringify({ occupation, priority }));
    localStorage.setItem(ONBOARDING_KEY, "1");
    dialog.close();
    analyticsTrack("preference_submitted", { metadata: { occupation, priority } });
  });
  window.addEventListener("resize", () => select(stage, selected[stage]));
  showStage("occupation");
}

function showSurveyIfNeeded() {
  const dialog = document.getElementById("onboardingDialog");
  if (!dialog || localStorage.getItem(PREFERENCE_KEY)) return;
  requestAnimationFrame(() => {
    if (!dialog.open) {
      dialog.showModal();
      dialog.dispatchEvent(new Event("preference-open"));
    }
  });
}

const DEVICE_MODE_KEY = "vi-device-mode-v1";

function setupDeviceGate() {
  const deviceDialog = document.getElementById("deviceDialog");
  const browserBtn = document.getElementById("chooseBrowserMode");
  const mobileBtn = document.getElementById("chooseMobileMode");
  const isMobileExperience = document.body.classList.contains("mobile-experience");

  if (isMobileExperience) {
    localStorage.setItem(DEVICE_MODE_KEY, "mobile");
    showSurveyIfNeeded();
    return;
  }

  const savedMode = localStorage.getItem(DEVICE_MODE_KEY);
  if (savedMode === "mobile") {
    location.replace("mobile.html");
    return;
  }
  if (savedMode === "browser") {
    showSurveyIfNeeded();
    return;
  }

  browserBtn?.addEventListener("click", () => {
    localStorage.setItem(DEVICE_MODE_KEY, "browser");
    analyticsTrack("device_mode_selected", { metadata: { mode: "browser" } });
    deviceDialog.close();
    showSurveyIfNeeded();
  });

  mobileBtn?.addEventListener("click", () => {
    localStorage.setItem(DEVICE_MODE_KEY, "mobile");
    analyticsTrack("device_mode_selected", { metadata: { mode: "mobile" } });
    analyticsFlush(true);
    setTimeout(() => { location.href = "mobile.html"; }, 90);
  });

  requestAnimationFrame(() => {
    if (!deviceDialog.open) deviceDialog.showModal();
  });
}

function updateAnalyticsBadge() {
  const badge = document.getElementById("analyticsBadge");
  if (!badge) return;
  badge.style.display = analyticsReady() ? "none" : "block";
}


const industries = [
  "テック・メディア",
  "総合商社",
  "メーカー・DX",
  "IT・SI",
  "人材・Platform",
  "通信",
  "自動車",
  "金融",
  "消費財・小売"
];

const detailedCompanies = [
  makeBasicCompany({name:"Sony Group", displayName:"ソニーグループ", industry:"テック・メディア", depth:145,
    summary:"エンタテインメント、ゲーム、イメージング、半導体など複数の事業を持つ大手企業。", website:"https://www.sony.com/ja/"}),
  makeBasicCompany({name:"ITOCHU", displayName:"伊藤忠商事", industry:"総合商社", depth:245,
    summary:"繊維、機械、金属、エネルギー・化学品、食料、住生活、情報・金融などを展開する総合商社。", website:"https://www.itochu.co.jp/ja/"}),
  makeBasicCompany({name:"Hitachi", displayName:"日立製作所", industry:"メーカー・DX", depth:420,
    summary:"IT、OT、プロダクトを組み合わせ、社会インフラやDXを展開する大手企業。", website:"https://www.hitachi.co.jp/"}),
  makeBasicCompany({name:"NTT DATA", displayName:"NTT DATA", industry:"IT・SI", depth:560,
    summary:"国内外でコンサルティング、システム開発、ITサービスを展開する大手IT企業グループ。", website:"https://www.nttdata.com/global/ja/"}),
  makeBasicCompany({name:"Recruit", displayName:"リクルート", industry:"人材・Platform", depth:750,
    summary:"人材、販促、マッチングプラットフォームを展開するリクルートグループの中核企業。", website:"https://www.recruit.co.jp/"}),
  makeBasicCompany({name:"Mitsubishi Corp.", displayName:"三菱商事", industry:"総合商社", depth:980,
    summary:"地球環境エネルギー、マテリアル、社会インフラ、モビリティ、食品、電力など幅広い事業を展開する総合商社。", website:"https://www.mitsubishicorp.com/jp/ja/"})
];

function makeBasicCompany({
  name, displayName, industry, depth, summary, website = ""
}) {
  return {
    name,
    displayName,
    industry,
    depth,
    summary,
    snapshot: [
      ["給与データ", "公式条件", "募集要項"],
      ["働き方", "制度開示", "公式採用情報"],
      ["福利厚生", "制度開示", "公式採用情報"],
      ["情報基準", "公式のみ", "採用・IR"]
    ],
    details: {
      compensation: {
        summary: "給与・賞与・評価は、会社が公開する募集要項・人事情報だけを表示します。",
        facts: [
          ["募集条件", "年度・職種・勤務地による違いを保持し、全社一律の数字へ丸めません。", "公式"],
          ["評価・報酬", "会社が公式に公開する人事制度・募集条件の範囲だけを表示します。", "公式"]
        ]
      },
      benefits: {
        summary: "福利厚生は制度名と適用条件を、公式採用・人事情報に基づいて表示します。",
        facts: [
          ["制度", "住宅、休暇、育児介護、資産形成、学習支援などの公式制度を対象にします。", "公式"],
          ["条件", "適用条件は年齢、勤務地、職種、雇用法人などの公式ルールを優先します。", "公式"]
        ]
      },
      stability: {
        summary: "事業構成と公式のIR・決算・統合報告書を基礎に経営情報を表示します。",
        facts: [
          ["事業基盤", summary, "公式"],
          ["経営情報", "企業公式サイトのIR・決算・統合報告書を出典として表示します。", "IR"]
        ]
      },
      culture: {
        summary: "社風は公式の理念・Values・人材制度までを扱い、人間関係を推測しません。",
        facts: [
          ["公式方針", "企業理念・Values・人材方針など会社が公表する内容のみを表示します。", "公式"],
          ["人間関係", "部署・上司単位の実態は公式情報から断定せず、理念・制度と分離して扱います。", "公式"]
        ]
      },
      workstyle: {
        summary: "勤務時間、休暇、フレックス、リモート、勤務地など公式に確認できる制度を表示します。",
        facts: [
          ["勤務制度", "公式募集要項に記載された職種・拠点別の条件を表示します。", "公式"],
          ["勤務地・転勤", "応募する法人・職種・コースの公式条件を優先します。", "公式"]
        ]
      },
      career: {
        summary: "配属、研修、専門職育成、社内公募など会社が公式に提供するキャリア機会を表示します。",
        facts: [
          ["育成", "職種別研修・OJT・専門育成など会社が公表する制度を表示します。", "公式"],
          ["配属・異動", "初期配属や職種確約の有無は公式採用区分を維持して表示します。", "公式"]
        ]
      }
    },
    sources: website ? [["企業公式サイト", "公式", website]] : []
  };
}

const basicCompanies = [
  makeBasicCompany({name:"Nintendo", displayName:"任天堂", industry:"テック・メディア", depth:330,
    summary:"ゲーム専用機、ソフトウェア、IPビジネスを展開する日本の大手エンターテインメント企業。", website:"https://www.nintendo.co.jp/"}),
  makeBasicCompany({name:"CyberAgent", displayName:"サイバーエージェント", industry:"テック・メディア", depth:670,
    summary:"インターネット広告、メディア、ゲームなどを展開する大手インターネット企業。", website:"https://www.cyberagent.co.jp/"}),
  makeBasicCompany({name:"Rakuten Group", displayName:"楽天グループ", industry:"テック・メディア", depth:1040,
    summary:"EC、FinTech、モバイル、デジタルサービスを横断する大手プラットフォーム企業。", website:"https://global.rakuten.com/corp/"}),

  makeBasicCompany({name:"Mitsui & Co.", displayName:"三井物産", industry:"総合商社", depth:360,
    summary:"金属資源、エネルギー、機械、化学品、生活産業などを展開する総合商社。", website:"https://www.mitsui.com/jp/ja/"}),
  makeBasicCompany({name:"Sumitomo Corporation", displayName:"住友商事", industry:"総合商社", depth:610,
    summary:"多様な産業分野で事業投資・トレーディングを行う総合商社。", website:"https://www.sumitomocorp.com/ja/jp"}),
  makeBasicCompany({name:"Marubeni", displayName:"丸紅", industry:"総合商社", depth:1110,
    summary:"電力・インフラ、食料、素材、輸送機、金融など幅広い事業領域を持つ総合商社。", website:"https://www.marubeni.com/jp/"}),

  makeBasicCompany({name:"Panasonic Holdings", displayName:"パナソニック ホールディングス", industry:"メーカー・DX", depth:250,
    summary:"家電、電池、B2Bソリューション、住宅・エネルギー領域などを展開する大手企業グループ。", website:"https://holdings.panasonic/jp/"}),
  makeBasicCompany({name:"Fujitsu", displayName:"富士通", industry:"メーカー・DX", depth:620,
    summary:"ITサービス、クラウド、コンピューティング、DX支援を展開する大手テクノロジー企業。", website:"https://global.fujitsu/ja-jp"}),
  makeBasicCompany({name:"NEC", displayName:"NEC", industry:"メーカー・DX", depth:1010,
    summary:"ITサービス、通信、社会インフラ、セキュリティなどを展開する大手テクノロジー企業。", website:"https://jpn.nec.com/"}),

  makeBasicCompany({name:"NRI", displayName:"野村総合研究所", industry:"IT・SI", depth:315,
    summary:"コンサルティングとITソリューションを組み合わせる大手シンクタンク・SI企業。", website:"https://www.nri.com/jp/"}),
  makeBasicCompany({name:"SCSK", displayName:"SCSK", industry:"IT・SI", depth:720,
    summary:"システム開発、ITインフラ、BPO、クラウドなどを提供する大手ITサービス企業。", website:"https://www.scsk.jp/"}),
  makeBasicCompany({name:"TIS", displayName:"TIS", industry:"IT・SI", depth:1150,
    summary:"決済、金融、産業、公共など多様な領域でITサービスを提供する大手SI企業。", website:"https://www.tis.co.jp/"}),

  makeBasicCompany({name:"PERSOL Holdings", displayName:"パーソルホールディングス", industry:"人材・Platform", depth:300,
    summary:"人材派遣、転職、BPO、テクノロジーなどを展開する大手人材サービスグループ。", website:"https://www.persol-group.co.jp/"}),
  makeBasicCompany({name:"en Japan", displayName:"エン・ジャパン", industry:"人材・Platform", depth:650,
    summary:"求人・採用支援、人材紹介、HR Techなどを展開する人材サービス企業。", website:"https://corp.en-japan.com/"}),
  makeBasicCompany({name:"dip", displayName:"ディップ", industry:"人材・Platform", depth:1080,
    summary:"求人情報サービスとDX事業を展開する人材・デジタルプラットフォーム企業。", website:"https://www.dip-net.co.jp/"}),

  makeBasicCompany({name:"NTT", displayName:"NTT", industry:"通信", depth:270,
    summary:"通信、IT、データセンター、研究開発などをグローバルに展開する大手通信グループ。", website:"https://group.ntt/jp/"}),
  makeBasicCompany({name:"KDDI", displayName:"KDDI", industry:"通信", depth:690,
    summary:"モバイル、固定通信、金融、DX、エネルギーなどを展開する大手通信企業。", website:"https://www.kddi.com/"}),
  makeBasicCompany({name:"SoftBank Corp.", displayName:"ソフトバンク", industry:"通信", depth:1090,
    summary:"通信、法人DX、AI、決済などを展開する大手通信・テクノロジー企業。", website:"https://www.softbank.jp/corp/"}),

  makeBasicCompany({name:"Toyota Motor", displayName:"トヨタ自動車", industry:"自動車", depth:190,
    summary:"自動車、モビリティ、電動化、ソフトウェア領域を展開する日本最大級のメーカー。", website:"https://global.toyota/jp/"}),
  makeBasicCompany({name:"Honda Motor", displayName:"本田技研工業", industry:"自動車", depth:520,
    summary:"四輪、二輪、パワープロダクツ、航空などを展開するグローバルメーカー。", website:"https://global.honda/jp/"}),
  makeBasicCompany({name:"DENSO", displayName:"デンソー", industry:"自動車", depth:820,
    summary:"自動車部品、電動化、半導体、ソフトウェアなどを展開する大手モビリティ企業。", website:"https://www.denso.com/jp/ja/"}),
  makeBasicCompany({name:"Nissan Motor", displayName:"日産自動車", industry:"自動車", depth:1180,
    summary:"自動車、EV、モビリティ技術を展開する大手完成車メーカー。", website:"https://www.nissan-global.com/JP/"}),

  makeBasicCompany({name:"MUFG", displayName:"三菱UFJフィナンシャル・グループ", industry:"金融", depth:230,
    summary:"銀行、信託、証券、カードなどを展開する日本最大級の総合金融グループ。", website:"https://www.mufg.jp/"}),
  makeBasicCompany({name:"SMFG", displayName:"三井住友フィナンシャルグループ", industry:"金融", depth:470,
    summary:"銀行、カード、証券、リースなどを展開する大手総合金融グループ。", website:"https://www.smfg.co.jp/"}),
  makeBasicCompany({name:"Mizuho FG", displayName:"みずほフィナンシャルグループ", industry:"金融", depth:720,
    summary:"銀行、信託、証券などを一体運営する大手総合金融グループ。", website:"https://www.mizuho-fg.co.jp/"}),
  makeBasicCompany({name:"Nomura Holdings", displayName:"野村ホールディングス", industry:"金融", depth:950,
    summary:"証券、投資銀行、資産運用などを展開する大手金融グループ。", website:"https://www.nomuraholdings.com/jp/"}),
  makeBasicCompany({name:"Tokio Marine Holdings", displayName:"東京海上ホールディングス", industry:"金融", depth:1190,
    summary:"損害保険を中心に国内外で保険・金融事業を展開する大手グループ。", website:"https://www.tokiomarinehd.com/"}),

  makeBasicCompany({name:"Fast Retailing", displayName:"ファーストリテイリング", industry:"消費財・小売", depth:210,
    summary:"UNIQLOを中心にグローバルでアパレル事業を展開する大手小売企業。", website:"https://www.fastretailing.com/jp/"}),
  makeBasicCompany({name:"Seven & i Holdings", displayName:"セブン＆アイ・ホールディングス", industry:"消費財・小売", depth:455,
    summary:"コンビニエンスストアを中心に小売・金融などを展開する大手流通グループ。", website:"https://www.7andi.com/"}),
  makeBasicCompany({name:"Kao", displayName:"花王", industry:"消費財・小売", depth:710,
    summary:"日用品、化粧品、ケミカル製品などを展開する大手消費財メーカー。", website:"https://www.kao.com/jp/"}),
  makeBasicCompany({name:"Ajinomoto", displayName:"味の素", industry:"消費財・小売", depth:920,
    summary:"食品、アミノサイエンス、ヘルスケアなどを展開する大手食品・化学企業。", website:"https://www.ajinomoto.co.jp/company/jp/"}),
  makeBasicCompany({name:"Shiseido", displayName:"資生堂", industry:"消費財・小売", depth:1170,
    summary:"化粧品を中心にグローバル展開する大手ビューティー企業。", website:"https://corp.shiseido.com/jp/"}),
  makeBasicCompany({name:"Mercari", displayName:"メルカリ", industry:"テック・メディア", depth:150,
    summary:"フリマ・FinTech・デジタルプラットフォームを展開する日本の大手企業。", website:"https://about.mercari.com/"}),
  makeBasicCompany({name:"MIXI", displayName:"MIXI", industry:"テック・メディア", depth:287,
    summary:"デジタルエンターテインメント・スポーツ・ライフスタイルを展開する日本の大手企業。", website:"https://mixi.co.jp/"}),
  makeBasicCompany({name:"Kakaku.com", displayName:"カカクコム", industry:"テック・メディア", depth:424,
    summary:"価格比較・飲食・旅行等のインターネットメディアを展開する日本の大手企業。", website:"https://corporate.kakaku.com/"}),
  makeBasicCompany({name:"GREE Holdings", displayName:"グリーホールディングス", industry:"テック・メディア", depth:561,
    summary:"ゲーム・メタバース・DX・投資を展開する日本の大手企業。", website:"https://hd.gree.net/jp/ja/"}),
  makeBasicCompany({name:"COLOPL", displayName:"コロプラ", industry:"テック・メディア", depth:698,
    summary:"スマートフォンゲーム・XR・エンターテインメントを展開する日本の大手企業。", website:"https://colopl.co.jp/"}),
  makeBasicCompany({name:"MonotaRO", displayName:"MonotaRO", industry:"テック・メディア", depth:835,
    summary:"事業者向けEC・データ活用・物流を展開する日本の大手企業。", website:"https://corp.monotaro.com/"}),
  makeBasicCompany({name:"ZOZO", displayName:"ZOZO", industry:"テック・メディア", depth:972,
    summary:"ファッションEC・計測技術・広告を展開する日本の大手企業。", website:"https://corp.zozo.com/"}),
  makeBasicCompany({name:"Kanematsu", displayName:"兼松", industry:"総合商社", depth:1109,
    summary:"電子・デバイス・食料・鉄鋼・車両等の商社事業を展開する日本の大手企業。", website:"https://www.kanematsu.co.jp/"}),
  makeBasicCompany({name:"Nagase & Co.", displayName:"長瀬産業", industry:"総合商社", depth:246,
    summary:"化学品・素材・ライフサイエンス・電子関連の商社事業を展開する日本の大手企業。", website:"https://www.nagase.co.jp/"}),
  makeBasicCompany({name:"Sony Semiconductor Solutions", displayName:"ソニーセミコンダクタソリューションズ", industry:"メーカー・DX", depth:383,
    summary:"イメージセンサー・半導体を展開する日本の大手企業。", website:"https://www.sony-semicon.com/ja/"}),
  makeBasicCompany({name:"Tokyo Electron", displayName:"東京エレクトロン", industry:"メーカー・DX", depth:520,
    summary:"半導体製造装置を展開する日本の大手企業。", website:"https://www.tel.co.jp/"}),
  makeBasicCompany({name:"Advantest", displayName:"アドバンテスト", industry:"メーカー・DX", depth:657,
    summary:"半導体試験装置を展開する日本の大手企業。", website:"https://www.advantest.com/ja/"}),
  makeBasicCompany({name:"Renesas Electronics", displayName:"ルネサス エレクトロニクス", industry:"メーカー・DX", depth:794,
    summary:"車載・産業向け半導体を展開する日本の大手企業。", website:"https://www.renesas.com/jp/ja"}),
  makeBasicCompany({name:"ROHM", displayName:"ローム", industry:"メーカー・DX", depth:931,
    summary:"半導体・電子部品を展開する日本の大手企業。", website:"https://www.rohm.co.jp/"}),
  makeBasicCompany({name:"Sumitomo Electric", displayName:"住友電気工業", industry:"メーカー・DX", depth:1068,
    summary:"自動車・情報通信・環境エネルギー関連製品を展開する日本の大手企業。", website:"https://sumitomoelectric.com/jp/"}),
  makeBasicCompany({name:"Mitsubishi Heavy Industries", displayName:"三菱重工業", industry:"メーカー・DX", depth:205,
    summary:"エネルギー・航空宇宙・防衛・産業機械を展開する日本の大手企業。", website:"https://www.mhi.com/jp"}),
  makeBasicCompany({name:"IHI", displayName:"IHI", industry:"メーカー・DX", depth:342,
    summary:"航空宇宙・エネルギー・社会インフラを展開する日本の大手企業。", website:"https://www.ihi.co.jp/"}),
  makeBasicCompany({name:"Kawasaki Heavy Industries", displayName:"川崎重工業", industry:"メーカー・DX", depth:479,
    summary:"航空宇宙・鉄道・船舶・ロボット・エネルギーを展開する日本の大手企業。", website:"https://www.khi.co.jp/"}),
  makeBasicCompany({name:"DMG MORI", displayName:"DMG森精機", industry:"メーカー・DX", depth:616,
    summary:"工作機械・自動化・デジタル製造を展開する日本の大手企業。", website:"https://www.dmgmori.co.jp/"}),
  makeBasicCompany({name:"SMC", displayName:"SMC", industry:"メーカー・DX", depth:753,
    summary:"空圧制御機器・FAを展開する日本の大手企業。", website:"https://www.smcworld.com/ja-jp/"}),
  makeBasicCompany({name:"Terumo", displayName:"テルモ", industry:"メーカー・DX", depth:890,
    summary:"医療機器・カテーテル・血液関連を展開する日本の大手企業。", website:"https://www.terumo.co.jp/"}),
  makeBasicCompany({name:"Olympus", displayName:"オリンパス", industry:"メーカー・DX", depth:1027,
    summary:"内視鏡・医療機器を展開する日本の大手企業。", website:"https://www.olympus.co.jp/"}),
  makeBasicCompany({name:"HOYA", displayName:"HOYA", industry:"メーカー・DX", depth:164,
    summary:"光学・半導体関連・医療を展開する日本の大手企業。", website:"https://www.hoya.com/"}),
  makeBasicCompany({name:"Asahi Kasei", displayName:"旭化成", industry:"メーカー・DX", depth:301,
    summary:"素材・住宅・ヘルスケアを展開する日本の大手企業。", website:"https://www.asahi-kasei.com/jp/"}),
  makeBasicCompany({name:"Accenture Japan", displayName:"アクセンチュア", industry:"IT・SI", depth:438,
    summary:"コンサルティング・テクノロジー・オペレーションを展開する日本の大手企業。", website:"https://www.accenture.com/jp-ja"}),
  makeBasicCompany({name:"NTT Communications", displayName:"NTTコミュニケーションズ", industry:"IT・SI", depth:575,
    summary:"法人ICT・ネットワーク・クラウドを展開する日本の大手企業。", website:"https://www.ntt.com/"}),
  makeBasicCompany({name:"IIJ", displayName:"インターネットイニシアティブ", industry:"IT・SI", depth:712,
    summary:"インターネット・クラウド・セキュリティを展開する日本の大手企業。", website:"https://www.iij.ad.jp/"}),
  makeBasicCompany({name:"CTC", displayName:"伊藤忠テクノソリューションズ", industry:"IT・SI", depth:849,
    summary:"SI・クラウド・データ活用を展開する日本の大手企業。", website:"https://www.ctc-g.co.jp/"}),
  makeBasicCompany({name:"NSSOL", displayName:"日鉄ソリューションズ", industry:"IT・SI", depth:986,
    summary:"SI・ITインフラ・DXを展開する日本の大手企業。", website:"https://www.nssol.nipponsteel.com/"}),
  makeBasicCompany({name:"NEC Solutions Innovators", displayName:"NECソリューションイノベータ", industry:"IT・SI", depth:1123,
    summary:"SI・ソフトウェア・社会DXを展開する日本の大手企業。", website:"https://www.nec-solutioninnovators.co.jp/"}),
  makeBasicCompany({name:"Hitachi Solutions", displayName:"日立ソリューションズ", industry:"IT・SI", depth:260,
    summary:"SI・クラウド・セキュリティを展開する日本の大手企業。", website:"https://www.hitachi-solutions.co.jp/"}),
  makeBasicCompany({name:"Works Applications", displayName:"ワークスアプリケーションズ", industry:"IT・SI", depth:397,
    summary:"ERP・業務ソフトウェアを展開する日本の大手企業。", website:"https://www.worksap.co.jp/"}),
  makeBasicCompany({name:"Money Forward", displayName:"マネーフォワード", industry:"IT・SI", depth:534,
    summary:"FinTech・バックオフィスSaaSを展開する日本の大手企業。", website:"https://corp.moneyforward.com/"}),
  makeBasicCompany({name:"Sansan", displayName:"Sansan", industry:"IT・SI", depth:671,
    summary:"営業DX・名刺/請求書SaaSを展開する日本の大手企業。", website:"https://jp.corp-sansan.com/"}),
  makeBasicCompany({name:"Visional", displayName:"ビジョナル", industry:"人材・Platform", depth:808,
    summary:"HR Tech・採用プラットフォームを展開する日本の大手企業。", website:"https://www.visional.inc/"}),
  makeBasicCompany({name:"Mynavi", displayName:"マイナビ", industry:"人材・Platform", depth:945,
    summary:"就職・転職・生活情報サービスを展開する日本の大手企業。", website:"https://www.mynavi.jp/"}),
  makeBasicCompany({name:"Leverages", displayName:"レバレジーズ", industry:"人材・Platform", depth:1082,
    summary:"人材・医療・IT・海外事業を展開する日本の大手企業。", website:"https://leverages.jp/"}),
  makeBasicCompany({name:"Persol Career", displayName:"パーソルキャリア", industry:"人材・Platform", depth:219,
    summary:"転職・採用・HRサービスを展開する日本の大手企業。", website:"https://www.persol-career.co.jp/"}),
  makeBasicCompany({name:"OpenWork", displayName:"オープンワーク", industry:"人材・Platform", depth:356,
    summary:"社員クチコミ・採用プラットフォームを展開する日本の大手企業。", website:"https://www.openwork.co.jp/"}),
  makeBasicCompany({name:"NTT DOCOMO", displayName:"NTTドコモ", industry:"通信", depth:493,
    summary:"モバイル・スマートライフ・法人DXを展開する日本の大手企業。", website:"https://www.docomo.ne.jp/corporate/"}),
  makeBasicCompany({name:"Rakuten Mobile", displayName:"楽天モバイル", industry:"通信", depth:630,
    summary:"モバイル通信・クラウドネイティブネットワークを展開する日本の大手企業。", website:"https://corp.mobile.rakuten.co.jp/"}),
  makeBasicCompany({name:"Isuzu Motors", displayName:"いすゞ自動車", industry:"自動車", depth:767,
    summary:"商用車・ディーゼル・物流ソリューションを展開する日本の大手企業。", website:"https://www.isuzu.co.jp/"}),
  makeBasicCompany({name:"Hino Motors", displayName:"日野自動車", industry:"自動車", depth:904,
    summary:"商用車・トラック・バスを展開する日本の大手企業。", website:"https://www.hino.co.jp/"}),
  makeBasicCompany({name:"Toyota Industries", displayName:"豊田自動織機", industry:"自動車", depth:1041,
    summary:"自動車・産業車両・物流機器を展開する日本の大手企業。", website:"https://www.toyota-shokki.co.jp/"}),
  makeBasicCompany({name:"JTEKT", displayName:"ジェイテクト", industry:"自動車", depth:178,
    summary:"ステアリング・軸受・工作機械を展開する日本の大手企業。", website:"https://www.jtekt.co.jp/"}),
  makeBasicCompany({name:"Resona Holdings", displayName:"りそなホールディングス", industry:"金融", depth:315,
    summary:"銀行・信託・法人/個人金融を展開する日本の大手企業。", website:"https://www.resona-gr.co.jp/"}),
  makeBasicCompany({name:"SBI Shinsei Bank", displayName:"SBI新生銀行", industry:"金融", depth:452,
    summary:"銀行・リテール・法人金融を展開する日本の大手企業。", website:"https://www.sbishinseibank.co.jp/"}),
  makeBasicCompany({name:"Dai-ichi Life Holdings", displayName:"第一生命ホールディングス", industry:"金融", depth:589,
    summary:"生命保険・資産運用・海外保険を展開する日本の大手企業。", website:"https://www.dai-ichi-life-hd.com/"}),
  makeBasicCompany({name:"Nippon Life", displayName:"日本生命", industry:"金融", depth:726,
    summary:"生命保険・資産運用を展開する日本の大手企業。", website:"https://www.nissay.co.jp/"}),
  makeBasicCompany({name:"Meiji Yasuda Life", displayName:"明治安田生命", industry:"金融", depth:863,
    summary:"生命保険・資産運用を展開する日本の大手企業。", website:"https://www.meijiyasuda.co.jp/"}),
  makeBasicCompany({name:"Sumitomo Life", displayName:"住友生命", industry:"金融", depth:1000,
    summary:"生命保険・健康増進サービスを展開する日本の大手企業。", website:"https://www.sumitomolife.co.jp/"}),
  makeBasicCompany({name:"Mitsubishi HC Capital", displayName:"三菱HCキャピタル", industry:"金融", depth:1137,
    summary:"リース・事業投資・航空・物流・再エネを展開する日本の大手企業。", website:"https://www.mitsubishi-hc-capital.com/"}),
  makeBasicCompany({name:"JCB", displayName:"ジェーシービー", industry:"金融", depth:274,
    summary:"クレジットカード・決済を展開する日本の大手企業。", website:"https://www.global.jcb/ja/"}),
  makeBasicCompany({name:"Suntory Holdings", displayName:"サントリーホールディングス", industry:"消費財・小売", depth:411,
    summary:"飲料・酒類・食品・健康を展開する日本の大手企業。", website:"https://www.suntory.co.jp/company/"}),
  makeBasicCompany({name:"Calbee", displayName:"カルビー", industry:"消費財・小売", depth:548,
    summary:"スナック・食品を展開する日本の大手企業。", website:"https://www.calbee.co.jp/corporate/"}),
  makeBasicCompany({name:"Morinaga & Co.", displayName:"森永製菓", industry:"消費財・小売", depth:685,
    summary:"菓子・食品・健康を展開する日本の大手企業。", website:"https://www.morinaga.co.jp/company/"}),
  makeBasicCompany({name:"Lion Corporation", displayName:"ライオン", industry:"消費財・小売", depth:822,
    summary:"オーラルケア・日用品を展開する日本の大手企業。", website:"https://www.lion.co.jp/ja/"}),
  makeBasicCompany({name:"Pigeon", displayName:"ピジョン", industry:"消費財・小売", depth:959,
    summary:"ベビー・育児用品を展開する日本の大手企業。", website:"https://www.pigeon.co.jp/"}),
  makeBasicCompany({name:"ABC-Mart", displayName:"エービーシー・マート", industry:"消費財・小売", depth:1096,
    summary:"シューズ小売を展開する日本の大手企業。", website:"https://www.abc-mart.co.jp/"}),
  makeBasicCompany({name:"Don Quijote / PPIH", displayName:"パン・パシフィック・インターナショナルホールディングス", industry:"消費財・小売", depth:233,
    summary:"ディスカウント小売・海外小売を展開する日本の大手企業。", website:"https://ppih.co.jp/"}),
  makeBasicCompany({name:"Yamada Holdings", displayName:"ヤマダホールディングス", industry:"消費財・小売", depth:370,
    summary:"家電小売・住宅・金融を展開する日本の大手企業。", website:"https://www.yamada-holdings.jp/"})

];

const companies = [...detailedCompanies, ...basicCompanies];

companies.push(makeBasicCompany({
  name:"KEYENCE",
  displayName:"キーエンス",
  industry:"メーカー・DX",
  depth:1145,
  summary:"FAセンサー、測定機器、画像処理機器などをグローバルに展開する高収益メーカー。",
  website:"https://www.keyence.co.jp/"
}));


companies.forEach(company => {
  const profile = OFFICIAL_PROFILE_OVERRIDES[company.name];
  if (!profile) return;
  company.displayName = profile.displayName || company.displayName;
  company.summary = profile.summary || company.summary;
  company.snapshot = profile.snapshot;
  company.details = profile.details;
  company.sources = profile.sources;
});


const LEGENDARY_GAFA = [{"name":"Google (Alphabet)","displayName":"Google","industry":"テック・メディア","depth":280,"legendary":true,"summary":"検索、YouTube、Google Cloud、Android、AIなどを展開するAlphabet傘下のグローバルテクノロジー企業。","snapshot":[["企業区分","GAFA","Legendary"],["採用情報","職種・地域別","公式Careers"],["事業","検索・広告・Cloud・AI","公式"],["情報基準","公式のみ","Careers・IR"]],"details":{"compensation":{"summary":"報酬は国・勤務地・職種・レベルごとの差が大きいため、各求人の公式レンジを基準に確認します。","facts":[["報酬","職種・勤務地ごとに求人票で条件が示されるため、全社一律の初任給として表示しません。","公式"],["評価・報酬","役割・レベル・地域ごとの公式求人条件を優先します。","公式"]]},"benefits":{"summary":"福利厚生は地域・雇用形態ごとに異なるため、Google Careersの公式条件を基準に扱います。","facts":[["制度","健康、休暇、家族支援、成長支援などは地域・職種の公式採用情報で確認します。","公式"],["適用条件","国・勤務地・雇用形態により適用範囲が異なります。","公式"]]},"stability":{"summary":"検索、広告、YouTube、Cloud、AIなど複数の事業基盤を持つAlphabetグループの中核企業です。","facts":[["事業基盤","検索、YouTube、Google Cloud、Android、AIなど複数領域を展開。","公式"],["IR","財務情報はAlphabet Investor Relationsの公式開示を基準に確認します。","IR"]]},"culture":{"summary":"公式にはユーザー保護、責任あるAI、機会拡大、社会貢献などのコミットメントを掲げています。","facts":[["公式方針","世界中の情報を整理し、アクセス可能で有用にすることを使命として掲げています。","公式"],["人間関係","部署・上司単位の実態は公式情報から断定しません。","公式"]]},"workstyle":{"summary":"勤務条件はポジションと勤務地ごとに異なるため、各求人票の公式条件を表示基準にします。","facts":[["勤務制度","ポジション・勤務地別の求人票を優先します。","公式"],["勤務地","日本を含む世界各地で職種別採用を実施しています。","公式"]]},"career":{"summary":"ソフトウェア、AI、Cloud、セールス、プロダクトなど幅広い職種で専門キャリアを形成できます。","facts":[["職種","Software Engineering、AI/ML、Cloud、Sales、Product等の職種別採用。","公式"],["成長","職種・レベルに応じた採用とキャリア機会を公式Careersで公開。","公式"]]}},"sources":[["Google Careers","公式","https://www.google.com/about/careers/applications/jobs/results/"],["About Google","公式","https://about.google/intl/ja_ALL/company-info/"],["Alphabet Investor Relations","IR","https://abc.xyz/investor/"]]},{"name":"Apple","displayName":"Apple","industry":"メーカー・DX","depth":430,"legendary":true,"summary":"iPhone、Mac、Apple Watchなどのハードウェアと、OS・サービスを一体で展開するグローバルテクノロジー企業。","snapshot":[["企業区分","GAFA","Legendary"],["採用情報","職種・地域別","公式Careers"],["事業","Hardware・Software・Services","公式"],["情報基準","公式のみ","Careers・IR"]],"details":{"compensation":{"summary":"Appleの報酬条件は職種・勤務地ごとに異なるため、公式求人票の条件を基準に扱います。","facts":[["報酬","全世界共通の一律初任給ではなく、各ポジションの公式求人条件を優先します。","公式"],["評価","日本向け公式採用情報では、労働時間や勤続年数よりイノベーションと成果を重視する評価方針を紹介しています。","公式"]]},"benefits":{"summary":"Appleは健康、休暇、家族支援、株式、教育支援などの福利厚生を公式に案内しています。","facts":[["制度","医療・メンタルヘルス、有給休暇、家族支援、株式付与、教育支援など。","公式"],["適用条件","福利厚生は国・地域・雇用条件により異なります。","公式"]]},"stability":{"summary":"ハードウェア、ソフトウェア、サービスを統合した事業モデルを持ちます。","facts":[["事業基盤","iPhone、Mac、Wearables、Services等をグローバルに展開。","公式"],["IR","財務情報はApple Investor Relationsの公式開示を基準に確認します。","IR"]]},"culture":{"summary":"公式Careersでは、インクルージョン、成長、独創性、プライバシー等の価値観を紹介しています。","facts":[["公式方針","個人の想像力とチームによるイノベーションを重視。","公式"],["人間関係","部署・上司単位の実態は公式情報から断定しません。","公式"]]},"workstyle":{"summary":"職種・国・拠点によって勤務条件が異なるため、公式求人票を基準にします。","facts":[["勤務制度","日本向け求人を含め、職種ごとに勤務時間・勤務地を明示。","公式"],["勤務地","Retail、Engineering、Sales等で日本の募集があります。","公式"]]},"career":{"summary":"Hardware、Software、AIML、Retail、Operationsなど幅広い専門職があります。","facts":[["職種","AIML、Hardware、Software、R&D、Retail等。","公式"],["成長","Apple Universityや教育費支援など、公式に成長支援制度を紹介。","公式"]]}},"sources":[["Apple Careers Japan","公式","https://www.apple.com/careers/jp/"],["Apple Benefits Japan","公式","https://www.apple.com/careers/jp/life-at-apple/benefits.html"],["Apple Investor Relations","IR","https://investor.apple.com/"]]},{"name":"Meta","displayName":"Meta (Facebook)","industry":"テック・メディア","depth":560,"legendary":true,"summary":"Facebook、Instagram、WhatsAppなどのプラットフォームと、AI・Reality Labs領域を展開するグローバルテクノロジー企業。","snapshot":[["企業区分","GAFA","Legendary"],["採用情報","職種・地域別","公式Careers"],["事業","SNS・広告・AI・XR","公式"],["情報基準","公式のみ","Careers・IR"]],"details":{"compensation":{"summary":"報酬は職種・勤務地・レベルにより異なるため、Meta Careersの各求人条件を基準に扱います。","facts":[["報酬","ポジション単位の公式条件を優先し、全社一律の初任給としては扱いません。","公式"],["評価・報酬","職種・レベル別の採用条件を公式求人情報で確認します。","公式"]]},"benefits":{"summary":"福利厚生は勤務地・雇用形態により異なるため、Meta Careersの公式情報を基準にします。","facts":[["制度","健康、家族、休暇、成長支援等は地域別の公式Careers情報を優先。","公式"],["適用条件","国・勤務地・雇用条件によって制度が異なります。","公式"]]},"stability":{"summary":"Family of AppsとReality Labsを中心に、広告・AI・XRへ投資する事業構造です。","facts":[["事業基盤","Facebook、Instagram、WhatsApp等のFamily of AppsとReality Labsを展開。","公式"],["IR","財務・人員・投資情報はMeta Investor Relationsで公式開示。","IR"]]},"culture":{"summary":"公式CareersではAIへの全社的な注力、スピード、イノベーション等を発信しています。","facts":[["公式方針","AI・技術開発を通じた新しい体験の構築を重視。","公式"],["人間関係","部署・上司単位の実態は公式情報から断定しません。","公式"]]},"workstyle":{"summary":"勤務条件はポジション・勤務地ごとに異なるため、各求人票の公式条件を基準にします。","facts":[["勤務制度","職種・勤務地別の求人条件を公式Careersで提示。","公式"],["勤務地","Engineering、AI、Product、Business等でグローバル採用。","公式"]]},"career":{"summary":"AI、Engineering、Product、Design、Business等で専門キャリアを形成できます。","facts":[["職種","AI、Software Engineering、Product、Design等。","公式"],["成長","大規模なAIインフラとプロダクト開発環境を公式Careersで紹介。","公式"]]}},"sources":[["Meta Careers","公式","https://www.metacareers.com/"],["Meta AI Careers","公式","https://www.metacareers.com/teams/technology?tab=AI"],["Meta Investor Relations","IR","https://investor.atmeta.com/"]]},{"name":"Amazon","displayName":"Amazon","industry":"消費財・小売","depth":700,"legendary":true,"summary":"EC、AWS、物流、広告、デバイスなどを世界規模で展開するグローバルテクノロジー・小売企業。","snapshot":[["企業区分","GAFA","Legendary"],["採用情報","職種・地域別","公式Jobs"],["事業","EC・AWS・物流・広告","公式"],["情報基準","公式のみ","Jobs・IR"]],"details":{"compensation":{"summary":"報酬は職種・勤務地・雇用形態で異なるため、Amazon Jobsの各求人条件を基準に扱います。","facts":[["報酬","全社一律の初任給ではなく、ポジションごとの公式条件を優先します。","公式"],["株式","公式福利厚生ページでは、多くの従業員にRSUを通じた株式保有機会があると案内しています。","公式"]]},"benefits":{"summary":"Amazonは医療、休暇、家族支援、キャリア開発、株式などの福利厚生を公式に案内しています。","facts":[["制度","医療、将来への貯蓄、休暇、家族支援、Employee Assistance、キャリア支援等。","公式"],["適用条件","勤務地、国、勤務時間、雇用形態などにより利用できる制度が異なります。","公式"]]},"stability":{"summary":"EC、AWS、物流、広告、デバイスなど複数の大規模事業を持ちます。","facts":[["事業基盤","オンライン小売、AWS、物流、広告、デバイス等を展開。","公式"],["IR","財務情報はAmazon Investor Relationsの公式開示を基準に確認します。","IR"]]},"culture":{"summary":"公式にはLeadership Principlesを日々の意思決定や仕事の基準として使用すると説明しています。","facts":[["公式方針","Leadership Principlesをプロジェクトや問題解決の判断基準として運用。","公式"],["人間関係","部署・上司単位の実態は公式情報から断定しません。","公式"]]},"workstyle":{"summary":"勤務条件は国・職種・拠点・雇用形態で異なるため、各求人票の公式条件を基準にします。","facts":[["勤務制度","Corporate、Tech、Operations等で勤務形態が異なります。","公式"],["勤務地","日本を含む世界各地で職種別採用。","公式"]]},"career":{"summary":"Tech、AWS、Operations、Businessなど幅広い職種と内部異動・キャリア開発機会があります。","facts":[["職種","Software、AWS、Operations、Business等。","公式"],["成長","公式福利厚生ページで内部異動やキャリア開発プログラムを案内。","公式"]]}},"sources":[["Amazon Jobs Japan","公式","https://www.amazon.jobs/ja/"],["Amazon Benefits","公式","https://amazon.jobs/content/jp/benefits"],["Amazon Investor Relations","IR","https://ir.aboutamazon.com/"]]}];
LEGENDARY_GAFA.forEach(company => companies.push(company));




function persistCompanyCatalog() {
  try {
    localStorage.setItem("vi-company-catalog-v1", JSON.stringify(companies));
  } catch (error) {
    console.warn("Could not persist company catalog:", error);
  }
}


const INTEREST_KEY = "vi-interest-signals-v1";
function recordInterest(industry,type,amount=1){
  if(!industry) return;
  try{
    const all=JSON.parse(localStorage.getItem(INTEREST_KEY)||"{}");
    const row=all[industry]||{dig:0,discover:0,open:0,save:0};
    row[type]=(Number(row[type])||0)+amount;
    all[industry]=row;
    localStorage.setItem(INTEREST_KEY,JSON.stringify(all));
  }catch(_){}
}
function currentTool(){
  if(state.level>=100) return {id:"drill",name:"ドリル",impact:30};
  if(state.level>=50) return {id:"shovel",name:"赤柄シャベル",impact:21};
  return {id:"hand",name:"手掘り",impact:14};
}
function gainDigXp(){
  if(state.level>=100){state.level=100;state.xp=0;return;}
  state.xp+=10;
  while(state.xp>=30 && state.level<100){
    state.xp-=30; state.level+=1;
    if(state.level===50) showToast("赤柄シャベルをアンロック！ Lv.50");
    else if(state.level===100){state.xp=0;showToast("ドリルをアンロック！ Lv.100");}
  }
}

const state = {
  level: Math.max(1, Math.min(100, Number(localStorage.getItem("vi-dig-level-v2") || 1))),
  xp: Math.max(0, Number(localStorage.getItem("vi-dig-xp-v2") || 0)),
  discovered: new Set(JSON.parse(localStorage.getItem("vi-major-discovered-v2") || "[]")),
  saved: new Set(JSON.parse(localStorage.getItem("vi-major-saved-v2") || "[]")),
  deepest: Number(localStorage.getItem("vi-major-deepest-v2") || 0),
  scoreFilter: 50,
  stageFilter: "ALL",
  collectionFilter: "ALL",
  activeIndustryFilter: "ALL",
  selectedCompany: null,
  detailTab: "compensation"
};

const els = {
  industryRuler: document.getElementById("industryRuler"),
  zoneLines: document.getElementById("zoneLines"),
  mineStage: document.getElementById("mineStage"),
  mineWrap: document.getElementById("mineWrap"),
  grassSurface: document.getElementById("grassSurface"),
  oreLayer: document.getElementById("oreLayer"),
  canvas: document.getElementById("digCanvas"),
  hint: document.getElementById("digHint"),
  depthFloat: document.getElementById("depthFloat"),
  industryFloat: document.getElementById("industryFloat"),
levelValue: document.getElementById("levelValue"),
  toolNow: document.getElementById("toolNow"),
  xpMeter: document.getElementById("xpMeter"),
  discoveredValue: document.getElementById("discoveredValue"),
  deepestValue: document.getElementById("deepestValue"),
  collectionCount: document.getElementById("collectionCount"),
  collectionList: document.getElementById("collectionList"),
  companyDialog: document.getElementById("companyDialog"),
  filterDialog: document.getElementById("filterDialog"),
  toast: document.getElementById("toast"),
  soilPhysicsLayer: document.getElementById("soilPhysicsLayer"),
  shovel: document.getElementById("shovelTool"),
  shovelDockLabel: document.getElementById("shovelDockLabel"),
  detailTabs: document.getElementById("detailTabs"),
  detailBody: document.getElementById("detailBody"),
  snapshotGrid: document.getElementById("snapshotGrid"),
  dialogSources: document.getElementById("dialogSources")
};

let ctx;
let toastTimer;

const SURFACE_BINS = 220;
const EXCAVATION_STORAGE_KEY = "vi-major-excavation-v3";
const EXCAVATION_INDEX_CELL = 72;
const MAX_EXCAVATION_STROKES = 6000;
let surfaceProfile = new Array(SURFACE_BINS).fill(0); // Legacy v2 progress.
let excavationStrokes = [];
let excavationIndex = new Map();
let nextExcavationSeed = 1;
let clods = [];
let lastPhysicsTime = performance.now();

const shovelPhysics = {
  x: 0,
  y: 0,
  vx: 0,
  vy: 0,
  angle: 7,
  angleV: 0,
  targetX: 0,
  targetY: 0,
  grabbed: false,
  holding: false,
  pointerId: null,
  holdTimer: null,
  digArmed: true,
  previousTipY: null,
  impactCooldown: 0
};

function persist() {
  localStorage.setItem("vi-major-discovered-v2", JSON.stringify([...state.discovered]));
  localStorage.setItem("vi-major-saved-v2", JSON.stringify([...state.saved]));
  localStorage.setItem("vi-major-deepest-v2", String(state.deepest));
  localStorage.setItem("vi-dig-level-v2", String(state.level));
  localStorage.setItem("vi-dig-xp-v2", String(state.xp));

  const h = Math.max(1, els.mineStage.clientHeight);
  const normalized = surfaceProfile.map(v => Math.max(0, Math.min(1, v / h)));
  localStorage.setItem("vi-major-surface-v2", JSON.stringify(normalized));

  try {
    const compact = excavationStrokes.map(stroke => [
      Number(stroke.x.toFixed(5)),
      Number(stroke.y.toFixed(5)),
      Number(stroke.r.toFixed(5)),
      stroke.seed
    ]);
    localStorage.setItem(EXCAVATION_STORAGE_KEY, JSON.stringify(compact));
  } catch (error) {
    console.warn("Could not persist excavation mask:", error);
  }
}

function loadExcavationState() {
  try {
    const saved = JSON.parse(localStorage.getItem("vi-major-surface-v2") || "null");
    if (Array.isArray(saved) && saved.length === SURFACE_BINS) {
      const h = Math.max(1, els.mineStage.clientHeight);
      surfaceProfile = saved.map(v => Math.max(0, Math.min(h - 10, Number(v || 0) * h)));
    } else {
      surfaceProfile = new Array(SURFACE_BINS).fill(0);
    }
  } catch (_) {
    surfaceProfile = new Array(SURFACE_BINS).fill(0);
  }

  try {
    const saved = JSON.parse(localStorage.getItem(EXCAVATION_STORAGE_KEY) || "[]");
    excavationStrokes = Array.isArray(saved)
      ? saved
          .filter(row => Array.isArray(row) && row.length >= 4)
          .map(row => ({
            x: Math.max(0, Math.min(1, Number(row[0]) || 0)),
            y: Math.max(0, Math.min(1, Number(row[1]) || 0)),
            r: Math.max(.001, Math.min(.2, Number(row[2]) || .01)),
            seed: Math.max(1, Math.round(Number(row[3]) || 1))
          }))
      : [];
  } catch (_) {
    excavationStrokes = [];
  }

  nextExcavationSeed = excavationStrokes.reduce((max, stroke) => Math.max(max, stroke.seed), 0) + 1;
  rebuildExcavationIndex();
}

function initials(name) {
  return name.split(/\s+/).map(x => x[0]).join("").replace(/\W/g, "").slice(0, 2).toUpperCase() || "VI";
}

function seededOffset(name) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return ((h % 6000) / 6000) * .72 + .14;
}



function getPlayableDepth(company) {
  // Preserve relative rarity/depth, but compress the old 0–1250m distribution
  // so useful discoveries happen in the upper half of the quarry.
  return Math.max(150, Math.min(690, Math.round(100 + Number(company.depth || 0) * .48)));
}

function oreShapeFor(name) {
  let h = 2166136261 >>> 0;
  for (const ch of String(name)) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619) >>> 0;
  }
  const shapes = [
    "polygon(48% 0%, 82% 8%, 100% 39%, 88% 82%, 58% 100%, 16% 90%, 0 58%, 12% 19%)",
    "polygon(31% 0%, 76% 5%, 100% 31%, 91% 72%, 67% 100%, 24% 91%, 0 62%, 8% 20%)",
    "polygon(55% 0%, 90% 18%, 96% 55%, 73% 96%, 29% 100%, 0 72%, 7% 27%, 27% 8%)",
    "polygon(44% 0%, 83% 16%, 100% 54%, 78% 89%, 40% 100%, 8% 84%, 0 39%, 17% 10%)",
    "polygon(26% 4%, 68% 0%, 100% 23%, 94% 67%, 70% 96%, 30% 100%, 0 68%, 5% 30%)",
    "polygon(50% 0%, 91% 14%, 100% 46%, 82% 91%, 46% 100%, 9% 79%, 0 40%, 20% 8%)",
    "polygon(38% 0%, 79% 11%, 100% 48%, 87% 85%, 55% 100%, 13% 91%, 0 53%, 15% 17%)",
    "polygon(57% 2%, 93% 25%, 100% 61%, 69% 100%, 31% 91%, 0 66%, 10% 26%, 30% 0%)"
  ];
  return shapes[h % shapes.length];
}

function setupQuarryHorizontalScroll() {
  const scroller = document.getElementById("quarryScroll");
  const cue = document.getElementById("quarryScrollCue");
  if (!scroller) return;

  const updateCue = () => {
    if (!cue) return;
    cue.classList.toggle("hidden", scroller.scrollLeft > 36);
  };
  scroller.addEventListener("scroll", updateCue, { passive: true });
  updateCue();
}

function centerIndustryZoneHorizontally(industry) {
  const scroller = document.getElementById("quarryScroll");
  const stage = document.getElementById("mineStage");
  if (!scroller || !stage) return;

  const index = industries.indexOf(industry);
  if (index < 0) return;

  const zoneWidth = stage.clientWidth / industries.length;
  const targetCenter = (index + .5) * zoneWidth;
  const targetLeft = Math.max(0, targetCenter - scroller.clientWidth / 2);
  scroller.scrollTo({ left: targetLeft, behavior: "smooth" });
}

function buildIndustryRuler() {
  els.industryRuler.innerHTML = "";
  els.industryRuler.style.gridTemplateColumns = `repeat(${industries.length}, 1fr)`;
  industries.forEach((industry, i) => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = industry;
    b.dataset.industry = industry;
    b.addEventListener("click", () => {
      els.industryRuler.querySelectorAll("button").forEach(x => x.classList.toggle("active", x === b));
      centerIndustryZoneHorizontally(industry);
      const target = companies.find(c => c.industry === industry);
      const depth = target ? getPlayableDepth(target) : 300;
      const stageTop = els.mineWrap.offsetTop + (depth / 1250) * els.mineStage.clientHeight;
      window.scrollTo({ top: Math.max(0, stageTop - window.innerHeight * .45), behavior: "smooth" });
      showToast(`${industry} の鉱脈へ移動`);
    });
    els.industryRuler.appendChild(b);

    if (i > 0) {
      const line = document.createElement("i");
      line.style.left = `${(i / industries.length) * 100}%`;
      els.zoneLines.appendChild(line);
    }
  });
}

function renderOres() {
  els.oreLayer.innerHTML = "";

  companies.forEach(company => {
    if (state.saved.has(company.name)) return; // collected ores leave the quarry
    if (state.activeIndustryFilter !== "ALL" && company.industry !== state.activeIndustryFilter) return;
    const zoneIndex = industries.indexOf(company.industry);
    if (zoneIndex < 0) return;
    const zoneStart = zoneIndex / industries.length;
    const zoneWidth = 1 / industries.length;
    const x = (zoneStart + seededOffset(company.name) * zoneWidth) * 100;
    const playableDepth = getPlayableDepth(company);
    const y = Math.max(5, Math.min(96, (playableDepth / 1250) * 100));

    const btn = document.createElement("button");
    btn.className = `ore${company.legendary ? " legendary" : ""}`;
    btn.type = "button";
    btn.dataset.name = company.name;
    btn.dataset.industry = company.industry;
    btn.style.left = `${x}%`;
    btn.style.top = `${y}%`;
    btn.style.setProperty("--ore-shape", oreShapeFor(company.name));
    const icon = INDUSTRY_PICTOGRAMS[company.industry] || "";
    btn.innerHTML = `
      <span class="ore-stone">${icon ? `<img class="ore-industry-icon" src="${icon}" alt="" aria-hidden="true">` : "◇"}</span>
      <span class="ore-label">
        <strong>${company.displayName}</strong>
        <small>${company.industry}${company.legendary ? " · GAFA" : ""}</small>
      </span>
    `;

    if (state.discovered.has(company.name)) btn.classList.add("revealed");

    btn.addEventListener("click", (e) => {
      if (btn.classList.contains("revealed")) {
        e.stopPropagation();
        openCompany(company);
      }
    });

    els.oreLayer.appendChild(btn);
  });
}

function drawCover() {
  const rect = els.mineStage.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  els.canvas.width = Math.round(rect.width * dpr);
  els.canvas.height = Math.round(els.mineStage.clientHeight * dpr);
  els.canvas.style.width = `${rect.width}px`;
  els.canvas.style.height = `${els.mineStage.clientHeight}px`;

  ctx = els.canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const w = rect.width;
  const h = els.mineStage.clientHeight;

  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0.00, "#b97b3b");
  grad.addColorStop(0.18, "#a56734");
  grad.addColorStop(0.38, "#8a542d");
  grad.addColorStop(0.58, "#674027");
  grad.addColorStop(0.78, "#49301f");
  grad.addColorStop(1.00, "#2b2018");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  const bands = [
    [0.16, "rgba(120,70,35,.26)"],
    [0.34, "rgba(96,54,29,.29)"],
    [0.53, "rgba(70,42,25,.30)"],
    [0.72, "rgba(48,31,22,.34)"],
    [0.90, "rgba(22,19,16,.38)"]
  ];

  bands.forEach(([p, color], idx) => {
    const y = p * h;
    ctx.beginPath();
    ctx.moveTo(0, y);
    const steps = 12;
    for (let s = 0; s <= steps; s++) {
      const x = (s / steps) * w;
      const wave = Math.sin(s * 1.65 + idx) * 18 + Math.sin(s * .55) * 8;
      ctx.lineTo(x, y + wave);
    }
    ctx.lineTo(w, h);
    ctx.lineTo(0, h);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
  });

  // Deterministic soil texture.
  let seed = 77;
  const rand = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };

  for (let i = 0; i < Math.round(w * h / 14000); i++) {
    const x = rand() * w;
    const y = rand() * h;
    const r = 1 + rand() * 6;
    ctx.beginPath();
    ctx.ellipse(x, y, r * 1.5, r, rand(), 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${30 + Math.floor(rand()*60)},${22 + Math.floor(rand()*38)},${15 + Math.floor(rand()*24)},${.16 + rand()*.22})`;
    ctx.fill();
  }

  eraseExcavatedSurface();
}

function eraseExcavatedSurface() {
  if (!ctx) return;
  const { w, h } = getStageMetrics();
  const step = w / (SURFACE_BINS - 1);

  rebuildExcavationIndex();

  ctx.save();
  ctx.globalCompositeOperation = "destination-out";

  // Keep excavation made with the previous one-dimensional engine.
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(w, 0);

  for (let i = SURFACE_BINS - 1; i >= 0; i--) {
    const roughX = i * step;
    const roughY = surfaceProfile[i];
    ctx.lineTo(roughX, roughY);
  }

  ctx.closePath();
  ctx.fillStyle = "#000";
  ctx.fill();

  excavationStrokes.forEach(stroke => eraseOrganicStroke(stroke, w, h));
  ctx.restore();
}

function getStageMetrics() {
  return {
    w: Math.max(1, els.mineStage.getBoundingClientRect().width),
    h: Math.max(1, els.mineStage.clientHeight)
  };
}

function excavationNoise(seed, offset) {
  const value = Math.sin((seed + offset * 97.17) * 12.9898) * 43758.5453;
  return value - Math.floor(value);
}

function strokePixels(stroke, w, h) {
  return {
    x: stroke.x * w,
    y: stroke.y * h,
    r: stroke.r * Math.min(w, h),
    seed: stroke.seed
  };
}

function excavationIndexKey(column, row) {
  return `${column}:${row}`;
}

function addStrokeToExcavationIndex(stroke) {
  const { w, h } = getStageMetrics();
  const px = strokePixels(stroke, w, h);
  const reach = px.r * 1.16;
  const minColumn = Math.floor((px.x - reach) / EXCAVATION_INDEX_CELL);
  const maxColumn = Math.floor((px.x + reach) / EXCAVATION_INDEX_CELL);
  const minRow = Math.floor((px.y - reach) / EXCAVATION_INDEX_CELL);
  const maxRow = Math.floor((px.y + reach) / EXCAVATION_INDEX_CELL);

  for (let column = minColumn; column <= maxColumn; column++) {
    for (let row = minRow; row <= maxRow; row++) {
      const key = excavationIndexKey(column, row);
      if (!excavationIndex.has(key)) excavationIndex.set(key, []);
      excavationIndex.get(key).push(stroke);
    }
  }
}

function rebuildExcavationIndex() {
  excavationIndex = new Map();
  excavationStrokes.forEach(addStrokeToExcavationIndex);
}

function legacySurfaceDepthAtX(x) {
  const { w } = getStageMetrics();
  const pos = Math.max(0, Math.min(SURFACE_BINS - 1, (x / w) * (SURFACE_BINS - 1)));
  const i0 = Math.floor(pos);
  const i1 = Math.min(SURFACE_BINS - 1, i0 + 1);
  const t = pos - i0;
  return surfaceProfile[i0] * (1 - t) + surfaceProfile[i1] * t;
}

function isPointExcavated(localX, localY) {
  const { w, h } = getStageMetrics();
  if (localY < 0 || localX < 0 || localX > w) return true;
  if (localY > h) return false;
  if (localY < legacySurfaceDepthAtX(localX)) return true;

  const column = Math.floor(localX / EXCAVATION_INDEX_CELL);
  const row = Math.floor(localY / EXCAVATION_INDEX_CELL);
  const candidates = excavationIndex.get(excavationIndexKey(column, row)) || [];

  for (let i = candidates.length - 1; i >= 0; i--) {
    const px = strokePixels(candidates[i], w, h);
    const dx = localX - px.x;
    const dy = localY - px.y;
    if (dx * dx + dy * dy <= Math.pow(px.r * 1.05, 2)) return true;
  }
  return false;
}

function excavationFrontierAt(localX, localY, radius) {
  let hasAir = isPointExcavated(localX, localY);
  let hasSoil = !hasAir;
  const sampleRadius = radius * .76;

  for (let i = 0; i < 12; i++) {
    const angle = (i / 12) * Math.PI * 2;
    const excavated = isPointExcavated(
      localX + Math.cos(angle) * sampleRadius,
      localY + Math.sin(angle) * sampleRadius
    );
    hasAir ||= excavated;
    hasSoil ||= !excavated;
  }

  return hasAir && hasSoil;
}

function brushRadiusForTool(tool = currentTool()) {
  if (tool.id === "drill") return 38;
  if (tool.id === "shovel") return 28;
  return 20;
}

function eraseOrganicStroke(stroke, w, h) {
  if (!ctx) return;
  const px = strokePixels(stroke, w, h);

  ctx.beginPath();
  ctx.arc(px.x, px.y, px.r * .84, 0, Math.PI * 2);

  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2 + excavationNoise(px.seed, i) * .42;
    const distance = px.r * (.54 + excavationNoise(px.seed, i + 20) * .16);
    const lobeRadius = px.r * (.25 + excavationNoise(px.seed, i + 40) * .17);
    ctx.moveTo(px.x + Math.cos(angle) * distance + lobeRadius, px.y + Math.sin(angle) * distance);
    ctx.arc(
      px.x + Math.cos(angle) * distance,
      px.y + Math.sin(angle) * distance,
      lobeRadius,
      0,
      Math.PI * 2
    );
  }

  ctx.fillStyle = "#000";
  ctx.fill();
}

function compactExcavationStrokes() {
  if (excavationStrokes.length <= MAX_EXCAVATION_STROKES) return false;
  const recentStart = excavationStrokes.length - 1200;
  excavationStrokes = excavationStrokes.filter((_, index) => index >= recentStart || index % 2 === 0);
  rebuildExcavationIndex();
  return true;
}

function stampOrganicExcavation(localX, localY, radius) {
  const { w, h } = getStageMetrics();
  const stroke = {
    x: Math.max(0, Math.min(1, localX / w)),
    y: Math.max(0, Math.min(1, localY / h)),
    r: Math.max(.001, Math.min(.2, radius / Math.min(w, h))),
    seed: nextExcavationSeed++
  };

  excavationStrokes.push(stroke);
  addStrokeToExcavationIndex(stroke);

  if (ctx) {
    ctx.save();
    ctx.globalCompositeOperation = "destination-out";
    eraseOrganicStroke(stroke, w, h);
    ctx.restore();
  }

  if (compactExcavationStrokes()) drawCover();
  return stroke;
}

function carveOrganicPath(fromX, fromY, toX, toY, radius) {
  const distance = Math.hypot(toX - fromX, toY - fromY);
  const spacing = Math.max(5, radius * .34);
  const steps = Math.max(1, Math.ceil(distance / spacing));
  const carved = [];

  for (let step = 0; step <= steps; step++) {
    const progress = steps ? step / steps : 1;
    const x = fromX + (toX - fromX) * progress;
    const y = fromY + (toY - fromY) * progress;
    if (!excavationFrontierAt(x, y, radius)) continue;
    carved.push(stampOrganicExcavation(x, y, radius));
  }

  return carved;
}

function getCompanyPoint(company) {
  const zoneIndex = industries.indexOf(company.industry);
  const zoneStart = zoneIndex / industries.length;
  const zoneWidth = 1 / industries.length;
  return {
    x: (zoneStart + seededOffset(company.name) * zoneWidth) * els.mineStage.getBoundingClientRect().width,
    y: (getPlayableDepth(company) / 1250) * els.mineStage.clientHeight
  };
}

function surfaceDepthAtX(x) {
  const { h } = getStageMetrics();
  for (let y = 0; y <= h; y += 4) {
    if (!isPointExcavated(x, y)) return y;
  }
  return h;
}

function carveWithShovel(localX, downwardSpeed) {
  const localY = surfaceDepthAtX(localX);
  digAtLocalPoint(localX, localY, localX, Math.max(0, localY - 4), true, downwardSpeed);
}

function revealCompaniesNear(localX, localY, brushRadius) {
  let found = null;

  companies.forEach(company => {
    if (state.discovered.has(company.name)) return;

    const p = getCompanyPoint(company);
    const industry = getIndustryFromX(localX);
    if (company.industry !== industry) return;

    const uncovered = isPointExcavated(p.x, p.y);
    const closeToBrush = Math.hypot(p.x - localX, p.y - localY) <= brushRadius + 34;
    if (uncovered && closeToBrush) {
      state.discovered.add(company.name);
      recordInterest(company.industry,"discover");
      const ore = [...document.querySelectorAll(".ore")].find(el => el.dataset.name === company.name);
      if (ore) ore.classList.add("revealed");
      found = company;
    }
  });

  if (found) {
    analyticsTrack("company_discovered", {
      industry: found.industry,
      company: found.displayName,
      depth_m: getPlayableDepth(found)
    });
    showToast(`${found.legendary ? "✦ LEGENDARY：" : "発見："}${found.displayName}`);
    setTimeout(() => openCompany(found), 220);
  }

  return found;
}

function getIndustryFromX(x) {
  const width = els.mineStage.getBoundingClientRect().width;
  const idx = Math.max(0, Math.min(industries.length - 1, Math.floor((x / width) * industries.length)));
  return industries[idx];
}

function getDepthFromY(y) {
  return Math.round((y / els.mineStage.clientHeight) * 1250);
}

function spawnSoilClods(localX, localY, impactSpeed) {
  const count = Math.max(7, Math.min(16, Math.round(7 + impactSpeed * .08)));

  for (let i = 0; i < count; i++) {
    const el = document.createElement("i");
    el.className = "soil-clod";
    const size = 5 + Math.random() * 11;
    const hue = [
      "#9b6132", "#81502c", "#b06d36", "#6f4529", "#c07a3d"
    ][Math.floor(Math.random() * 5)];

    el.style.setProperty("--size", `${size}px`);
    el.style.setProperty("--clod", hue);
    el.style.setProperty("--rot", `${Math.random() * 180}deg`);
    els.soilPhysicsLayer.appendChild(el);

    clods.push({
      el,
      x: localX + (Math.random() - .5) * 18,
      y: localY - 2 - Math.random() * 8,
      vx: (Math.random() - .5) * (2.8 + impactSpeed * .035),
      vy: -1.7 - Math.random() * (3.1 + impactSpeed * .026),
      rot: Math.random() * 180,
      rv: (Math.random() - .5) * 8,
      bounces: 0,
      age: 0
    });
  }

  const flash = document.createElement("i");
  flash.className = "impact-flash";
  flash.style.left = `${localX}px`;
  flash.style.top = `${localY}px`;
  els.soilPhysicsLayer.appendChild(flash);
  setTimeout(() => flash.remove(), 380);
}

function updateSoilPhysics(dt) {
  const h = els.mineStage.clientHeight;
  const w = els.mineStage.getBoundingClientRect().width;

  clods = clods.filter(p => {
    p.age += dt;
    p.vy += 25 * dt;
    p.vx *= Math.pow(.985, dt * 60);
    p.x += p.vx * dt * 60;
    p.y += p.vy * dt * 60;
    p.rot += p.rv * dt * 60;

    if (p.x < 0 || p.x > w) {
      p.vx *= -.35;
      p.x = Math.max(1, Math.min(w - 1, p.x));
    }

    let ground = h + 30;
    for (let y = Math.max(0, p.y); y <= h; y += 4) {
      if (!isPointExcavated(p.x, y)) {
        ground = y;
        break;
      }
    }
    if (p.vy > 0 && p.y >= ground - 2) {
      p.y = ground - 2;
      p.vy *= -.27;
      p.vx *= .58;
      p.rv *= .62;
      p.bounces += 1;
    }

    const opacity = p.age > 1.35 ? Math.max(0, 1 - (p.age - 1.35) / .55) : 1;
    p.el.style.left = `${p.x}px`;
    p.el.style.top = `${p.y}px`;
    p.el.style.opacity = opacity;
    p.el.style.transform = `translate(-50%, -50%) rotate(${p.rot}deg)`;

    if (p.age > 1.9 || p.y > h + 30 || p.bounces > 4) {
      p.el.remove();
      return false;
    }
    return true;
  });
}

function digAtLocalPoint(
  localX,
  localY = 0,
  fromX = localX,
  fromY = localY,
  reward = true,
  impactOverride = null
) {
  const rect = els.mineStage.getBoundingClientRect();
  localX = Math.max(0, Math.min(rect.width, localX));
  localY = Math.max(0, Math.min(rect.height, localY));
  fromX = Math.max(0, Math.min(rect.width, fromX));
  fromY = Math.max(0, Math.min(rect.height, fromY));

  const tool = currentTool();
  const impact = impactOverride ?? tool.impact;
  const brushRadius = brushRadiusForTool(tool) + Math.min(8, Math.max(0, impact - tool.impact) * .08);
  const carved = carveOrganicPath(fromX, fromY, localX, localY, brushRadius);
  if (!carved.length) return false;

  if (reward) {
    gainDigXp();
    recordInterest(getIndustryFromX(localX), "dig");
    spawnSoilClods(localX, localY, impact);
    revealCompaniesNear(localX, localY, brushRadius);

    analyticsTrack("dig", {
      industry: getIndustryFromX(localX),
      x_position: localX / Math.max(1, rect.width),
      depth_m: getDepthFromY(Math.min(rect.height, localY + brushRadius)),
      metadata: {
        dig_power_level: state.level,
        brush_radius: Number(brushRadius.toFixed(1)),
        path_dx: Number((localX - fromX).toFixed(1)),
        path_dy: Number((localY - fromY).toFixed(1))
      }
    });
  }

  if (reward) {
    const pulse = document.createElement("span");
    pulse.className = "click-dig-pulse";
    pulse.style.left = `${localX}px`;
    pulse.style.top = `${localY}px`;
    els.mineStage.appendChild(pulse);
    setTimeout(() => pulse.remove(), 420);
  }

  const deepestPixel = carved.reduce((max, stroke) => {
    const px = strokePixels(stroke, rect.width, rect.height);
    return Math.max(max, px.y + px.r);
  }, localY + brushRadius);
  state.deepest = Math.max(state.deepest, getDepthFromY(Math.min(rect.height, deepestPixel)));
  els.hint.classList.add("hidden");
  if (reward) {
    persist();
    if (navigator.vibrate) navigator.vibrate(8);
    updateStatus();
  }
  return true;
}

function pointOverSoil(clientX, clientY) {
  const rect = els.mineStage.getBoundingClientRect();
  if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) return false;

  const localX = clientX - rect.left;
  const localY = clientY - rect.top;
  return !isPointExcavated(localX, localY);
}

function digAtClientPoint(clientX, clientY, fromClientX = clientX, fromClientY = clientY, reward = true) {
  const rect = els.mineStage.getBoundingClientRect();
  return digAtLocalPoint(
    clientX - rect.left,
    clientY - rect.top,
    fromClientX - rect.left,
    fromClientY - rect.top,
    reward
  );
}

function updateSoilCursor(clientX, clientY, target = null) {
  if (target?.closest?.(".ore.revealed")) {
    els.mineStage.classList.remove("soil-hover");
    return;
  }
  els.mineStage.classList.toggle("soil-hover", pointOverSoil(clientX, clientY));
}

let digPointerGesture = null;

function onDigPointerDown(e) {
  if (e.isPrimary === false) return;
  if (e.pointerType === "mouse" && e.button !== 0) return;
  if (e.target.closest?.(".ore.revealed")) return;

  const rect = els.mineStage.getBoundingClientRect();
  const localX = e.clientX - rect.left;
  const localY = e.clientY - rect.top;
  const radius = brushRadiusForTool();
  if (!pointOverSoil(e.clientX, e.clientY) || !excavationFrontierAt(localX, localY, radius)) {
    if (pointOverSoil(e.clientX, e.clientY)) showToast("地表か、掘った穴の縁から掘り進めてください");
    return;
  }

  digPointerGesture = {
    pointerId: e.pointerId,
    lastX: e.clientX,
    lastY: e.clientY,
    lastRewardAt: performance.now()
  };
  els.mineStage.classList.add("digging-path");
  els.mineStage.setPointerCapture?.(e.pointerId);
  digAtClientPoint(e.clientX, e.clientY);
}

function onDigPointerMove(e) {
  const g = digPointerGesture;
  if (!g || e.pointerId !== g.pointerId) return;
  const distance = Math.hypot(e.clientX - g.lastX, e.clientY - g.lastY);
  if (distance < 3) return;

  const now = performance.now();
  const reward = now - g.lastRewardAt >= 120;
  const carved = digAtClientPoint(e.clientX, e.clientY, g.lastX, g.lastY, reward);
  g.lastX = e.clientX;
  g.lastY = e.clientY;
  if (reward && carved) g.lastRewardAt = now;
}

function onDigPointerUp(e) {
  const g = digPointerGesture;
  if (!g || e.pointerId !== g.pointerId) return;
  digPointerGesture = null;
  els.mineStage.classList.remove("digging-path");
  if (els.mineStage.hasPointerCapture?.(e.pointerId)) els.mineStage.releasePointerCapture(e.pointerId);
  persist();
  if (e.pointerType !== "touch") updateSoilCursor(e.clientX, e.clientY, e.target);
}

function cancelDigPointer(e) {
  if (!digPointerGesture) return;
  if (e.pointerId === undefined || e.pointerId === digPointerGesture.pointerId) {
    digPointerGesture = null;
    els.mineStage.classList.remove("digging-path");
    persist();
  }
}

function getShovelTipClient() {
  const length = 160;
  const rad = shovelPhysics.angle * Math.PI / 180;
  return {
    x: shovelPhysics.x + Math.sin(rad) * length,
    y: shovelPhysics.y + Math.cos(rad) * length
  };
}

function getShovelDock() {
  const rect = els.mineStage.getBoundingClientRect();
  const sidebarAllowance = window.innerWidth > 840 ? 24 : 18;
  return {
    x: Math.max(42, Math.min(window.innerWidth - 42, rect.right - sidebarAllowance - 42)),
    y: Math.max(96, Math.min(window.innerHeight - 230, 116))
  };
}

function setShovelDockInstant() {
  const d = getShovelDock();
  shovelPhysics.x = d.x;
  shovelPhysics.y = d.y;
  shovelPhysics.targetX = d.x;
  shovelPhysics.targetY = d.y;
  els.shovel.style.left = `${d.x}px`;
  els.shovel.style.top = `${d.y}px`;
  els.shovelDockLabel.style.left = `${d.x}px`;
  els.shovelDockLabel.style.top = `${d.y}px`;
}

function beginShovelHold(e) {
  if (e.button !== undefined && e.button !== 0) return;
  e.preventDefault();
  document.body.classList.add("dragging-shovel");
  shovelPhysics.holding = true;
  shovelPhysics.pointerId = e.pointerId;
  els.shovel.classList.add("holding");

  clearTimeout(shovelPhysics.holdTimer);
  shovelPhysics.holdTimer = setTimeout(() => {
    if (!shovelPhysics.holding) return;

    shovelPhysics.grabbed = true;
    shovelPhysics.digArmed = true;
    shovelPhysics.targetX = e.clientX;
    shovelPhysics.targetY = e.clientY;
    els.shovel.classList.add("grabbed");
    els.shovelDockLabel.classList.add("hidden");
    els.mineStage.classList.add("shovel-active");
    els.hint.classList.add("hidden");

    if (navigator.vibrate) navigator.vibrate(18);
    showToast("シャベルを掴みました。上から地面へ刺してください。");
  }, 260);
}

function moveShovelPointer(e) {
  if (!shovelPhysics.holding && !shovelPhysics.grabbed) return;
  if (shovelPhysics.pointerId !== null && e.pointerId !== shovelPhysics.pointerId) return;

  if (shovelPhysics.grabbed) {
    e.preventDefault();
    shovelPhysics.targetX = e.clientX;
    shovelPhysics.targetY = e.clientY;
  }
}

function releaseShovel(e) {
  if (shovelPhysics.pointerId !== null && e.pointerId !== undefined && e.pointerId !== shovelPhysics.pointerId) return;

  clearTimeout(shovelPhysics.holdTimer);
  document.body.classList.remove("dragging-shovel");
  shovelPhysics.holding = false;
  shovelPhysics.grabbed = false;
  shovelPhysics.pointerId = null;
  shovelPhysics.digArmed = true;
  els.shovel.classList.remove("holding", "grabbed");
  els.shovelDockLabel.classList.remove("hidden");
  els.mineStage.classList.remove("shovel-active");

  const d = getShovelDock();
  shovelPhysics.targetX = d.x;
  shovelPhysics.targetY = d.y;
}

function handleShovelCollision() {
  if (!shovelPhysics.grabbed || shovelPhysics.impactCooldown > 0) return;

  const stageRect = els.mineStage.getBoundingClientRect();
  const tip = getShovelTipClient();

  if (
    tip.x < stageRect.left ||
    tip.x > stageRect.right ||
    tip.y < stageRect.top - 18 ||
    tip.y > stageRect.bottom + 18
  ) {
    shovelPhysics.previousTipY = null;
    return;
  }

  const localX = tip.x - stageRect.left;
  const localY = tip.y - stageRect.top;
  const surfaceY = surfaceDepthAtX(localX);
  const surfaceClientY = stageRect.top + surfaceY;

  // Re-arm only after the blade has been lifted clearly ABOVE the current soil surface.
  if (!shovelPhysics.digArmed) {
    if (tip.y < surfaceClientY - 12) shovelPhysics.digArmed = true;
    else {
      // Solid-earth collision: don't allow the shovel to continue through side/bottom soil.
      if (tip.y > surfaceClientY + 9) {
        const correction = tip.y - (surfaceClientY + 9);
        shovelPhysics.y -= correction * .8;
        shovelPhysics.vy = Math.min(0, shovelPhysics.vy * -.08);
      }
      shovelPhysics.previousTipY = tip.y;
      return;
    }
  }

  const previous = shovelPhysics.previousTipY ?? tip.y;
  const crossedFromAbove = previous <= surfaceClientY + 3 && tip.y >= surfaceClientY - 1;
  const downwardSpeed = Math.max(0, shovelPhysics.vy);

  if (crossedFromAbove && downwardSpeed > .55 && shovelPhysics.digArmed) {
state.xp += 4;

    if (state.xp >= 20) {
      state.level += 1;
      state.xp = 0;
      showToast(`DIG POWER が Lv.${state.level} に上がりました`);
    }

    carveWithShovel(localX, downwardSpeed);
    const newSurface = surfaceDepthAtX(localX);

    spawnSoilClods(localX, newSurface, downwardSpeed);
    revealCompaniesNear(localX, newSurface, brushRadiusForTool());

    state.deepest = Math.max(state.deepest, getDepthFromY(newSurface));
    shovelPhysics.digArmed = false;
    shovelPhysics.impactCooldown = .13;
    shovelPhysics.vy *= -.12;

    // Collision response: the metal blade visibly meets resistance from the soil.
    const correctedClientSurface = stageRect.top + newSurface;
    const newTip = getShovelTipClient();
    if (newTip.y > correctedClientSurface + 8) {
      shovelPhysics.y -= (newTip.y - correctedClientSurface - 8);
    }

    if (navigator.vibrate) navigator.vibrate(10);
    updateStatus();
  }

  shovelPhysics.previousTipY = getShovelTipClient().y;
}

function physicsFrame(now) {
  const dt = Math.min(.032, Math.max(.001, (now - lastPhysicsTime) / 1000));
  lastPhysicsTime = now;

  const spring = shovelPhysics.grabbed ? 34 : 18;
  const damping = shovelPhysics.grabbed ? .78 : .82;

  shovelPhysics.vx += (shovelPhysics.targetX - shovelPhysics.x) * spring * dt;
  shovelPhysics.vy += (shovelPhysics.targetY - shovelPhysics.y) * spring * dt;
  shovelPhysics.vx *= Math.pow(damping, dt * 60);
  shovelPhysics.vy *= Math.pow(damping, dt * 60);

  shovelPhysics.x += shovelPhysics.vx * dt * 60;
  shovelPhysics.y += shovelPhysics.vy * dt * 60;

  const targetAngle = shovelPhysics.grabbed
    ? Math.max(-22, Math.min(22, shovelPhysics.vx * .7))
    : 7;

  shovelPhysics.angleV += (targetAngle - shovelPhysics.angle) * 22 * dt;
  shovelPhysics.angleV *= Math.pow(.76, dt * 60);
  shovelPhysics.angle += shovelPhysics.angleV * dt * 60;

  if (shovelPhysics.impactCooldown > 0) {
    shovelPhysics.impactCooldown = Math.max(0, shovelPhysics.impactCooldown - dt);
  }

  handleShovelCollision();
  updateSoilPhysics(dt);

  els.shovel.style.left = `${shovelPhysics.x}px`;
  els.shovel.style.top = `${shovelPhysics.y}px`;
  els.shovel.style.setProperty("--shovel-angle", `${shovelPhysics.angle}deg`);

  if (!shovelPhysics.grabbed) {
    els.shovelDockLabel.style.left = `${shovelPhysics.x}px`;
    els.shovelDockLabel.style.top = `${shovelPhysics.y}px`;
  }

  requestAnimationFrame(physicsFrame);
}


const VERIFIED_ALL_COMPANIES = true;
const verifiedProfileCache = new Map();

function viEsc(value) {
  return String(value ?? "").replace(/[&<>"']/g, ch => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[ch]));
}

function verifiedSourceLabel(type) {
  return ({
    official_site:"企業公式",
    official_recruit:"公式採用",
    official_ir:"公式IR",
    annual_securities_report:"有価証券報告書",
    integrated_report:"統合報告書",
    public_agency:"公的機関"
  })[type] || "公開情報";
}

function restoreLegacyDetailTabs() {
  els.detailTabs.innerHTML = `
    <button class="detail-tab active" data-detail="compensation">給料・評価</button>
    <button class="detail-tab" data-detail="benefits">福利厚生</button>
    <button class="detail-tab" data-detail="stability">経営安定性</button>
    <button class="detail-tab" data-detail="culture">社風・人間関係</button>
    <button class="detail-tab" data-detail="workstyle">働き方</button>
    <button class="detail-tab" data-detail="career">成長・キャリア</button>`;
  els.detailTabs.querySelectorAll(".detail-tab").forEach(btn => {
    btn.addEventListener("click", () => {
      if (!state.selectedCompany) return;
      state.detailTab = btn.dataset.detail;
      renderDetail(state.selectedCompany, state.detailTab);
    });
  });
}

function renderVerifiedDetail(company, categoryKey) {
  const profile = company.__verifiedProfile;
  if (!profile || !window.VICompanyData) return;
  const groups = window.VICompanyData.group(profile);
  const group = groups.find(g => g.key === categoryKey) || groups[0];
  if (!group) {
    els.detailBody.innerHTML = "";
    return;
  }
  const q = window.VICompanyData.quality(profile);
  els.detailBody.innerHTML = `
    <div class="verified-quality">
      <span>Verified Fields ${q.verifiedFields}</span>
      <span>Source Coverage ${q.sourceCoverageRate}%</span>
      <span>High Confidence ${q.highConfidenceRate}%</span>
      ${q.lastVerifiedAt ? `<span>Verified ${viEsc(String(q.lastVerifiedAt).slice(0,10))}</span>` : ""}
    </div>
    <div class="fact-list">
      ${group.points.map(p => `
        <div class="fact-row">
          <div class="fact-label">${viEsc(p.label)}</div>
          <div class="fact-value">${viEsc(p.display_value)}</div>
          <a class="source-pill official verified-fact-source" href="${viEsc(p.source_url)}" target="_blank" rel="noopener">${viEsc(verifiedSourceLabel(p.source_type))} ↗</a>
        </div>`).join("")}
    </div>`;
  els.detailTabs.querySelectorAll(".detail-tab").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.detail === group.key);
  });
  state.detailTab = group.key;
}

function applyVerifiedProfile(company, profile) {
  company.__verifiedProfile = profile;
  const groups = window.VICompanyData.group(profile);
  if (!groups.length) return;

  const verifiedIndustry = window.VICompanyData.point(profile, "industry");
  if (verifiedIndustry) document.getElementById("dialogIndustry").textContent = verifiedIndustry.display_value;
  const business = window.VICompanyData.point(profile, "business_description");
  if (business) document.getElementById("dialogSummary").textContent = business.display_value;

  let priority = "";
  try { priority = JSON.parse(localStorage.getItem(PREFERENCE_KEY) || "null")?.priority || ""; } catch (_) { /* Ignore invalid saved answers. */ }
  const priorityFields = {
    "給与": ["base_salary","starting_salary","average_salary","compensation_policy"],
    "仕事内容": ["main_business","career_program","business_description"],
    "働き方": ["annual_holidays","remote_work","average_overtime","workstyle_overview"],
    "福利厚生": ["housing_allowance","training_program","benefits_other"],
    "企業の安定性": ["revenue","operating_income","performance_summary","employee_count"],
    "成長環境": ["career_program","training_program","growth_rate"]
  };
  const featured = (priorityFields[priority] || []).map(field => window.VICompanyData.point(profile, field)).find(Boolean);
  const snapshotFields = ["base_salary","starting_salary","annual_holidays","employee_count_consolidated","employee_count","revenue"];
  const seen = new Set();
  if (featured) seen.add(featured.field_name);
  const snapshots = [];
  for (const field of snapshotFields) {
    const p = window.VICompanyData.point(profile, field);
    if (!p || seen.has(p.field_name) || snapshots.length >= (priority ? 3 : 4)) continue;
    seen.add(p.field_name);
    snapshots.push(p);
  }
  const featuredHtml = priority ? `<div class="snapshot-card priority-feature"><small>あなたが重視する「${viEsc(priority)}」 · ${featured ? viEsc(window.VICompanyData.fieldMeta[featured.field_name]?.[1] || featured.field_name) : "公式情報"}</small><strong>${featured ? viEsc(featured.display_value) : "公式情報はまだ確認できません"}</strong><span>${featured ? viEsc(verifiedSourceLabel(featured.source_type)) : "確認済みの別の項目は下に表示しています"}</span></div>` : "";
  els.snapshotGrid.innerHTML = featuredHtml + snapshots.map(p => {
    const meta = window.VICompanyData.fieldMeta[p.field_name];
    return `<div class="snapshot-card"><small>${viEsc(meta ? meta[1] : p.field_name)}</small><strong>${viEsc(p.display_value)}</strong><span>${viEsc(verifiedSourceLabel(p.source_type))}</span></div>`;
  }).join("");

  els.detailTabs.innerHTML = groups.map((g, i) =>
    `<button class="detail-tab ${i===0?"active":""}" data-detail="${viEsc(g.key)}">${viEsc(g.label)}</button>`
  ).join("");
  els.detailTabs.querySelectorAll(".detail-tab").forEach(btn => {
    btn.addEventListener("click", () => renderVerifiedDetail(company, btn.dataset.detail));
  });

  const sources = window.VICompanyData.uniqueSources(profile);
  els.dialogSources.innerHTML = sources.map(p => `
    <a class="source-link" href="${viEsc(p.source_url)}" target="_blank" rel="noopener">
      <strong>${viEsc(p.source_title || verifiedSourceLabel(p.source_type))}</strong>
      <span>${viEsc(verifiedSourceLabel(p.source_type))} · verified ${viEsc(String(p.verified_at || "").slice(0,10))} ↗</span>
    </a>`).join("");

  const q = window.VICompanyData.quality(profile);
  const banner = document.querySelector(".official-data-banner");
  if (banner) {
    banner.className = "official-data-banner verified-data-banner";
    banner.textContent = `VERIFIED PUBLIC DATA · ${q.verifiedFields}項目 · HIGH CONFIDENCE ONLY · 根拠のない項目は表示していません`;
  }
  const featuredGroup = featured && window.VICompanyData.fieldMeta[featured.field_name]?.[0];
  renderVerifiedDetail(company, groups.some(g => g.key === featuredGroup) ? featuredGroup : groups[0].key);
}

function renderVerifiedUnavailable(company, summary, message, options = {}) {
  if (state.selectedCompany !== company) return;
  document.getElementById("dialogSummary").textContent = summary;
  els.snapshotGrid.innerHTML = "";
  els.detailTabs.innerHTML = "";
  els.detailBody.innerHTML = `<div class="verified-empty-tech">${viEsc(message)}${
    options.retry ? `<br><button type="button" class="soft-btn verified-retry-btn">もう一度読み込む</button>` : ""
  }</div>`;
  const retryBtn = els.detailBody.querySelector(".verified-retry-btn");
  if (retryBtn) {
    retryBtn.addEventListener("click", () => {
      if (state.selectedCompany !== company) return;
      document.getElementById("dialogSummary").textContent = "確認済み公開情報を読み込んでいます…";
      els.detailBody.innerHTML = `<div class="verified-empty-tech">Supabaseから出典確認済みの企業情報を取得しています…</div>`;
      loadVerifiedProfile(company);
    });
  }
  els.dialogSources.innerHTML = "";
  const banner = document.querySelector(".official-data-banner");
  if (banner) {
    banner.className = "official-data-banner verified-data-banner";
    banner.textContent = "VERIFIED PUBLIC DATA · 表示できるのは出典確認済みの項目のみです";
  }
}

async function loadVerifiedProfile(company) {
  if (!window.VICompanyData) {
    renderVerifiedUnavailable(
      company,
      "企業情報の読み込み機能を初期化できませんでした。",
      "ページを再読み込みしてください。復旧しない場合は、時間をおいて再度お試しください。"
    );
    return;
  }
  try {
    let profile = verifiedProfileCache.get(company.name);
    if (profile === undefined) {
      profile = await window.VICompanyData.fetchVerifiedProfile(company.name);
      verifiedProfileCache.set(company.name, profile || null);
    }
    if (state.selectedCompany !== company) return;
    if (profile && profile.data_points?.length) {
      applyVerifiedProfile(company, profile);
    } else if (VERIFIED_ALL_COMPANIES) {
      renderVerifiedUnavailable(
        company,
        "この企業の確認済み公開情報は、現在準備中です。",
        "出典と確度を確認できた項目から順次公開します。"
      );
    }
  } catch (err) {
    console.warn("Verified company profile load failed", err);
    if (VERIFIED_ALL_COMPANIES && state.selectedCompany === company) {
      renderVerifiedUnavailable(
        company,
        "確認済み企業データの読み込みに失敗しました。",
        "推測データには切り替えません。通信状態を確認して、もう一度読み込んでください。",
        { retry: true }
      );
    }
  }
}

function sourceClass(sourceType) {
  if (sourceType === "公式") return "official";
  if (sourceType === "IR") return "ir";
  return "";
}

function renderDetail(company, tab) {
  if (company.__verifiedProfile) { renderVerifiedDetail(company, tab); return; }
  let section = company.details[tab];

  if (!section && tab === "benefits") {
    const compensationFacts = company.details.compensation?.facts || [];
    const benefitFacts = compensationFacts.filter(row =>
      /福利厚生|住宅|社宅|寮|退職|年金|持株|育児|介護|カフェテリア|手当/.test(row.join(" "))
    );
    section = {
      summary: "福利厚生は公式採用・人事情報の制度と適用条件だけを表示します。",
      facts: benefitFacts.length ? benefitFacts : [
        ["福利厚生", "公式採用サイトの制度情報を参照してください。", "公式"]
      ]
    };
  }

  if (!section) return;

  els.detailBody.innerHTML = `
    <p class="detail-summary">${section.summary}</p>
    <div class="fact-list">
      ${section.facts.map(([label, value, source]) => `
        <div class="fact-row">
          <div class="fact-label">${label}</div>
          <div class="fact-value">${value}</div>
          <span class="source-pill ${sourceClass(source)}">${source}</span>
        </div>
      `).join("")}
    </div>
  `;

  els.detailTabs.querySelectorAll(".detail-tab").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.detail === tab);
  });
}

function openCompany(company) {
  recordInterest(company.industry,"open");
  analyticsTrack("company_opened", {
    industry: company.industry,
    company: company.displayName,
    depth_m: company.depth
  });
  state.selectedCompany = company;
  state.detailTab = "compensation";
  company.__verifiedProfile = null;
  restoreLegacyDetailTabs();
  const banner = document.querySelector(".official-data-banner");
  if (banner) {
    banner.className = "official-data-banner";
    banner.textContent = "OFFICIAL DATA ONLY · 採用条件は年度・職種・勤務地で変わるため、数値には対象年度・募集区分を残しています。";
  }

  document.getElementById("dialogIndustry").textContent = company.industry;
  document.getElementById("dialogName").textContent = company.displayName;
  document.getElementById("dialogSummary").textContent = company.summary;

  els.snapshotGrid.innerHTML = company.snapshot.map(([label, value, note]) => `
    <div class="snapshot-card">
      <small>${label}</small>
      <strong>${value}</strong>
      <span>${note}</span>
    </div>
  `).join("");

  els.dialogSources.innerHTML = company.sources.length
    ? company.sources.map(([title, type, url]) => `
        <a class="source-link" href="${url}" target="_blank" rel="noopener">
          <strong>${title}</strong>
          <span>${type} ↗</span>
        </a>
      `).join("")
    : `<div class="source-link"><strong>企業公式サイト</strong><span>公式 ↗</span></div>`;

  document.getElementById("saveCompanyBtn").textContent =
    state.saved.has(company.name) ? "保存済み" : "コレクションに保存";

  if (VERIFIED_ALL_COMPANIES) {
    document.getElementById("dialogSummary").textContent = "確認済み公開情報を読み込んでいます…";
    els.snapshotGrid.innerHTML = "";
    els.detailTabs.innerHTML = "";
    els.detailBody.innerHTML = `<div class="verified-empty-tech">Supabaseから出典確認済みの企業情報を取得しています…</div>`;
    els.dialogSources.innerHTML = "";
    if (banner) {
      banner.className = "official-data-banner verified-data-banner loading";
      banner.textContent = "VERIFYING · SupabaseからHIGH confidenceの公開情報だけを取得中";
    }
  } else {
    renderDetail(company, "compensation");
  }
  els.companyDialog.showModal();
  loadVerifiedProfile(company);
}

function saveCurrentCompany() {
  if (!state.selectedCompany) return;
  const wasSaved = state.saved.has(state.selectedCompany.name);
  state.saved.add(state.selectedCompany.name);
  if (!wasSaved) {
    recordInterest(state.selectedCompany.industry,"save");
    analyticsTrack("company_saved", {
      industry: state.selectedCompany.industry,
      company: state.selectedCompany.displayName,
      depth_m: getPlayableDepth(state.selectedCompany)
    });
  }
  persist();
  renderCollection();
  renderOres();
  document.getElementById("saveCompanyBtn").textContent = "保存済み";
  showToast("コレクションに保存しました");
}

function renderCollection() {
  const savedCompanies = companies.filter(c =>
    state.saved.has(c.name) &&
    (state.collectionFilter === "ALL" || c.industry === state.collectionFilter)
  );

  els.collectionCount.textContent = state.saved.size;

  if (!savedCompanies.length) {
    els.collectionList.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">◇</div>
        <strong>${state.saved.size ? "この条件の企業はありません" : "まだ企業がありません"}</strong>
        <p>${state.saved.size ? "別のカテゴリを選択してください。" : "地中を掘って、最初の企業を発見しましょう。"}</p>
      </div>`;
    return;
  }

  els.collectionList.innerHTML = savedCompanies.map(c => `
    <article class="company-card">
      <button class="company-logo" data-open="${c.name}" aria-label="${c.displayName}を開く">${initials(c.name)}</button>
      <div>
        <h3>${c.displayName}</h3>
        <p>${c.summary}</p>
        <div class="tags">
          <span>${c.industry}</span>
          <span>${c.snapshot[0][1]}</span>
        </div>
      </div>
      <button class="card-remove" data-remove="${c.name}" aria-label="${c.displayName}を削除">⌑</button>
    </article>
  `).join("");

  els.collectionList.querySelectorAll("[data-open]").forEach(btn => {
    btn.addEventListener("click", () => {
      const c = companies.find(x => x.name === btn.dataset.open);
      if (c) openCompany(c);
    });
  });

  els.collectionList.querySelectorAll("[data-remove]").forEach(btn => {
    btn.addEventListener("click", () => {
      state.saved.delete(btn.dataset.remove);
      persist();
      renderCollection();
      renderOres();
    });
  });
}

function updateStatus() {
  els.levelValue.textContent = state.level;
  els.xpMeter.style.width = `${state.level>=100?100:(state.xp / 30) * 100}%`;
  const tool=currentTool();
  if(els.toolNow) els.toolNow.textContent = tool.name + (state.level<50?" · Lv.50でシャベル":state.level<100?" · Lv.100でドリル":" · MAX");
  els.mineStage.classList.remove("tool-hand","tool-shovel","tool-drill");
  els.mineStage.classList.add(`tool-${tool.id}`);
  els.discoveredValue.textContent = state.discovered.size;
  els.deepestValue.textContent = state.deepest;
}

function showToast(message) {
  clearTimeout(toastTimer);
  els.toast.textContent = message;
  els.toast.classList.add("show");
  toastTimer = setTimeout(() => els.toast.classList.remove("show"), 1900);
}


function resetDemo() {
  if (!confirm("採掘履歴とコレクションをリセットしますか？")) return;
  localStorage.removeItem("vi-major-discovered-v2");
  localStorage.removeItem("vi-major-saved-v2");
  localStorage.removeItem("vi-major-deepest-v2");
  localStorage.removeItem("vi-major-surface-v2");
  localStorage.removeItem(EXCAVATION_STORAGE_KEY);
  localStorage.removeItem("vi-dig-level-v2");
  localStorage.removeItem("vi-dig-xp-v2");
  localStorage.removeItem("vi-interest-signals-v1");
  location.reload();
}

function bindEvents() {
  document.getElementById("mobileMineBtn")?.addEventListener("click", () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
  document.getElementById("mobileBrowserBtn")?.addEventListener("click", () => {
    localStorage.setItem(DEVICE_MODE_KEY, "browser");
    location.href = "index.html";
  });
  document.querySelectorAll(".nav-item").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".nav-item").forEach(x => x.classList.toggle("active", x === btn));
      const nav = btn.dataset.nav;
      if (nav === "quarry") {
        window.scrollTo({ top: 0, behavior: "smooth" });
      } else if (nav === "conveyor") {
        location.href = "conveyor.html";
      } else if (nav === "collection") {
        location.href = "collection.html";
      } else if (nav === "report") {
        location.href = "report.html";
      }
    });
  });

  // Organic 2D excavation: press at an exposed edge, then drag sideways or diagonally.
  els.mineStage.addEventListener("pointerdown", onDigPointerDown);
  els.mineStage.addEventListener("pointermove", onDigPointerMove);
  els.mineStage.addEventListener("pointerup", onDigPointerUp);
  els.mineStage.addEventListener("pointercancel", cancelDigPointer);
  els.mineStage.addEventListener("pointerleave", () => els.mineStage.classList.remove("soil-hover"));


  els.mineStage.addEventListener("pointermove", (e) => {
    if (e.pointerType !== "touch") updateSoilCursor(e.clientX, e.clientY, e.target);
    const rect = els.mineStage.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    els.depthFloat.textContent = `${getDepthFromY(y)} m`;
    els.industryFloat.textContent = getIndustryFromX(x);
    els.depthFloat.style.left = `${e.clientX + 14}px`;
    els.depthFloat.style.top = `${e.clientY + 14}px`;
    els.industryFloat.style.left = `${e.clientX + 14}px`;
    els.industryFloat.style.top = `${e.clientY + 14}px`;
    els.depthFloat.style.display = "block";
    els.industryFloat.style.display = "block";
  });

  els.mineStage.addEventListener("pointerleave", () => {
    els.depthFloat.style.display = "none";
    els.industryFloat.style.display = "none";
  });

  document.getElementById("dialogClose").addEventListener("click", () => els.companyDialog.close());
  document.getElementById("saveCompanyBtn").addEventListener("click", saveCurrentCompany);
document.getElementById("resetBtn").addEventListener("click", resetDemo);

  els.detailTabs.querySelectorAll(".detail-tab").forEach(btn => {
    btn.addEventListener("click", () => {
      if (!state.selectedCompany) return;
      state.detailTab = btn.dataset.detail;
      renderDetail(state.selectedCompany, state.detailTab);
    });
  });

  document.getElementById("clearCollectionBtn").addEventListener("click", () => {
    state.saved.clear();
    persist();
    renderCollection();
    renderOres();
  });

  // Replace collection filters with current large-company categories.
  const tabs = document.querySelector(".collection-tabs");
  tabs.innerHTML = `
    <button class="chip active" data-filter="ALL">すべて</button>
    ${industries.map(industry => `<button class="chip" data-filter="${industry}">${industry}</button>`).join("")}
  `;

  tabs.querySelectorAll(".chip").forEach(chip => {
    chip.addEventListener("click", () => {
      state.collectionFilter = chip.dataset.filter;
      tabs.querySelectorAll(".chip").forEach(x => x.classList.toggle("active", x === chip));
      renderCollection();
    });
  });

  document.getElementById("openFilterBtn").addEventListener("click", () => {
    document.getElementById("industryFilter").value = state.activeIndustryFilter;
    els.filterDialog.showModal();
  });

  document.getElementById("filterClose")?.addEventListener("click", () => els.filterDialog.close());

  document.getElementById("applyFilterBtn")?.addEventListener("click", () => {
    state.activeIndustryFilter = document.getElementById("industryFilter").value;
    analyticsTrack("filter_applied", {
      industry: state.activeIndustryFilter === "ALL" ? null : state.activeIndustryFilter,
      metadata: { filter: state.activeIndustryFilter }
    });
    renderOres();
    els.filterDialog.close();
    showToast(state.activeIndustryFilter === "ALL"
      ? "すべての業界を採掘対象にしました"
      : `${state.activeIndustryFilter} に絞り込みました`);
  });

  document.getElementById("globalSearch").addEventListener("input", (e) => {
    const q = e.target.value.trim().toLowerCase();
    if (!q) return;

    const found = companies.find(c =>
      c.name.toLowerCase().includes(q) ||
      c.displayName.toLowerCase().includes(q) ||
      c.industry.toLowerCase().includes(q) ||
      Object.values(c.details).some(section =>
        section.summary.toLowerCase().includes(q) ||
        section.facts.some(row => row.join(" ").toLowerCase().includes(q))
      )
    );

    if (found) {
      const p = getCompanyPoint(found);
      const rect = els.mineStage.getBoundingClientRect();
      const pageY = window.scrollY + rect.top + p.y;
      window.scrollTo({ top: pageY - window.innerHeight * .42, behavior: "smooth" });
      showToast(`${found.displayName} の鉱脈付近へ移動`);
    }
  });

  document.getElementById("globalSearch").addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    const q = e.currentTarget.value.trim().toLowerCase();
    if (!q) return;
    const found = companies.find(c =>
      c.name.toLowerCase().includes(q) ||
      c.displayName.toLowerCase().includes(q) ||
      c.industry.toLowerCase().includes(q) ||
      c.summary.toLowerCase().includes(q)
    );
    if (found) {
      e.preventDefault();
      analyticsTrack("search_selected", {
        industry: found.industry,
        company: found.displayName,
        metadata: { query: q.slice(0, 80) }
      });
      openCompany(found);
    }
  });

  window.addEventListener("pagehide", () => analyticsFlush(true));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") analyticsFlush(true);
  });

  window.addEventListener("resize", () => {
    persist();
    loadExcavationState();
    renderOres();
    drawCover();

    if (!shovelPhysics.grabbed) {
      const d = getShovelDock();
      shovelPhysics.targetX = d.x;
      shovelPhysics.targetY = d.y;
    }
  });
}

function init() {
  const industryFilter = document.getElementById("industryFilter");
  if (industryFilter) {
    industryFilter.innerHTML = `<option value="ALL">すべての業界</option>` +
      industries.map(x => `<option value="${x}">${x}</option>`).join("");
  }
  buildIndustryRuler();
  setupQuarryHorizontalScroll();
  loadExcavationState();
  renderOres();
  drawCover();
  persistCompanyCatalog();
  renderCollection();
  updateStatus();
  bindEvents();
  setupOnboardingSurvey();
  setupDeviceGate();
  updateAnalyticsBadge();
  analyticsTrack("session_started", {
    metadata: {
      referrer: document.referrer ? "external_or_internal" : "direct",
      viewport_width: window.innerWidth,
      viewport_height: window.innerHeight
    }
  });
  requestAnimationFrame(physicsFrame);
}

init();

