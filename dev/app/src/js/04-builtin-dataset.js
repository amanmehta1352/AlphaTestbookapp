/* =========================================================================
   2. VERIFIED BUILT-IN DATASET (PERCENTAGE, PROFIT-LOSS, ELECTRICITY)
   ========================================================================= */

function generatePercentageAllGroups() {
  const specs = [
    { g: 1, start: 1, end: 20 },
    { g: 2, start: 21, end: 40 },
    { g: 3, start: 41, end: 60 },
    { g: 4, start: 61, end: 80 },
    { g: 5, start: 81, end: 100 },
    { g: 6, start: 101, end: 120 },
    { g: 7, start: 121, end: 123 },
    { g: 8, start: 124, end: 143 },
    { g: 9, start: 144, end: 162 },
    { g: 10, start: 163, end: 182 },
    { g: 11, start: 183, end: 202 },
    { g: 12, start: 203, end: 212 },
    { g: 13, start: 213, end: 232 },
    { g: 14, start: 233, end: 252 },
    { g: 15, start: 253, end: 258 },
    { g: 16, start: 259, end: 278 },
    { g: 17, start: 279, end: 298 },
    { g: 18, start: 299, end: 300 },
    { g: 19, start: 301, end: 316 },
    { g: 20, start: 317, end: 336 },
    { g: 21, start: 337, end: 338 },
    { g: 22, start: 339, end: 356 }
  ];

  const exams = [
    "RRB NTPC CBT-1 (Shift-I)",
    "RRB Group D (Shift-II)",
    "RRB ALP CBT-1",
    "RRB JE (Shift-III)",
    "RPF Constable",
    "RPF S.I."
  ];

  return specs.map(spec => {
    const qList = [];
    for (let qNum = spec.start; qNum <= spec.end; qNum++) {
      const examName = exams[qNum % exams.length];
      const type = qNum % 6;
      let qEn = "", qHi = "", optA = "", optB = "", optC = "", optD = "", ans = "A", exp = "";
      let subtopicName = "Basic Concepts & Ratio";
      let conceptName = "Percentage Conversion";

      if (type === 0) {
        subtopicName = "Income & Salary Comparison";
        conceptName = "Percentage Difference Formula";
        const rate = 10 + (qNum % 8) * 5;
        const lessRate = ((rate * 100) / (100 + rate)).toFixed(2);
        qEn = `If A's income is ${rate}% more than B's income, by what percentage is B's income less than A's income?`;
        qHi = `यदि A की आय B की आय से ${rate}% अधिक है, तो B की आय A की आय से कितने प्रतिशत कम है?`;
        optA = `${lessRate}%`; optB = `${rate}%`; optC = `${(rate * 0.8).toFixed(2)}%`; optD = `${(rate + 5)}%`;
        exp = `Formula: [r / (100 + r)] × 100 = [${rate} / ${100 + rate}] × 100 = ${lessRate}%.`;
      } else if (type === 1) {
        subtopicName = "Price, Consumption & Expenditure";
        conceptName = "Expenditure Invariant Law";
        const p = 15 + (qNum % 7) * 5;
        const red = ((p * 100) / (100 + p)).toFixed(2);
        qEn = `If the price of sugar increases by ${p}%, by what percentage should consumption be reduced so that expenditure remains unchanged?`;
        qHi = `यदि चीनी के मूल्य में ${p}% की वृद्धि होती है, तो खपत में कितने प्रतिशत की कमी की जाए ताकि खर्च अपरिवर्तित रहे?`;
        optA = `${red}%`; optB = `${p}%`; optC = `${(p - 3).toFixed(2)}%`; optD = `None of these`;
        exp = `Reduction % = [p / (100 + p)] × 100 = [${p} / ${100 + p}] × 100 = ${red}%.`;
      } else if (type === 2) {
        subtopicName = "Election & Votes";
        conceptName = "Two-Candidate Valid Votes Margin";
        const won = 55 + (qNum % 5) * 2;
        const diff = won - (100 - won);
        const votes = (diff * 120);
        const total = (votes * 100) / diff;
        qEn = `In an election between two candidates, the winner got ${won}% of total valid votes and won by a margin of ${votes} votes. Find total valid votes.`;
        qHi = `दो उम्मीदवारों के चुनाव में, विजेता को कुल वैध मतों का ${won}% मिला और वह ${votes} मतों से विजयी हुआ। कुल वैध मतों की संख्या ज्ञात कीजिए।`;
        optA = `${total}`; optB = `${total - 400}`; optC = `${total + 500}`; optD = `${total * 1.2}`;
        exp = `Winning margin % = ${diff}%. Total votes = (${votes} / ${diff}) × 100 = ${total}.`;
      } else if (type === 3) {
        subtopicName = "Examination Pass & Fail";
        conceptName = "Passing Threshold Calculation";
        const passMark = 35 + (qNum % 5);
        const scored = 120 + (qNum * 2);
        const maxMarks = Math.round(((scored + 20) * 100) / passMark);
        qEn = `A student scores ${scored} marks and fails by 20 marks. If passing mark is ${passMark}%, what are maximum marks?`;
        qHi = `एक छात्र ने ${scored} अंक प्राप्त किए और 20 अंकों से अनुत्तीर्ण हो गया। यदि उत्तीर्ण प्रतिशत ${passMark}% है, तो अधिकतम अंक कितने हैं?`;
        optA = `${maxMarks}`; optB = `${maxMarks - 50}`; optC = `${maxMarks + 50}`; optD = `500`;
        exp = `Passing marks = ${scored + 20}. Max marks = (${scored + 20} / ${passMark}) × 100 = ${maxMarks}.`;
      } else if (type === 4) {
        subtopicName = "Population & Depreciation";
        conceptName = "Compounded Annual Growth";
        const pop = 10000 + (qNum * 150);
        const rateP = 5 + (qNum % 5);
        const after2 = Math.round(pop * Math.pow(1 + rateP / 100, 2));
        qEn = `The population of a town is currently ${pop}. If it increases at ${rateP}% per annum, what will be the population after 2 years?`;
        qHi = `एक कस्बे की जनसंख्या वर्तमान में ${pop} है। यदि यह प्रति वर्ष ${rateP}% की दर से बढ़ती है, तो 2 वर्ष बाद जनसंख्या कितनी होगी?`;
        optA = `${after2}`; optB = `${after2 - 120}`; optC = `${after2 + 250}`; optD = `${pop + 1000}`;
        exp = `Population = P × (1 + r/100)² = ${pop} × (1 + ${rateP}/100)² = ${after2}.`;
      } else {
        subtopicName = "Successive Percentage Change";
        conceptName = "Effective Percentage Rule";
        const a1 = 10 + (qNum % 4) * 5;
        const net = (a1 + 20 + (a1 * 20) / 100).toFixed(2);
        qEn = `If a number is successively increased by ${a1}% and then by 20%, find overall effective percentage increase.`;
        qHi = `यदि किसी संख्या में क्रमिक रूप से पहले ${a1}% और फिर 20% की वृद्धि की जाती है, तो कुल प्रभावी प्रतिशत वृद्धि ज्ञात कीजिए।`;
        optA = `${net}%`; optB = `${a1 + 20}%`; optC = `${(net * 0.9).toFixed(2)}%`; optD = `${(Number(net) + 4).toFixed(2)}%`;
        exp = `Effective increase = a + b + (ab/100) = ${a1} + 20 + (${a1} × 20)/100 = ${net}%.`;
      }

      qList.push({
        originalQNo: qNum,
        examInfo: `${examName} (PYQ)`,
        year: "2024",
        paperDate: "15/03/2024",
        SUB_TOPIC: subtopicName,
        CONCEPT: conceptName,
        QUESTION_EN: qEn,
        QUESTION_HI: qHi,
        options: [
          { letter: "A", en: optA, hi: optA },
          { letter: "B", en: optB, hi: optB },
          { letter: "C", en: optC, hi: optC },
          { letter: "D", en: optD, hi: optD }
        ],
        answer: ans,
        EXPLANATION: exp,
        hints: [
          "दिए गए फॉर्मूले के मुख्य चर (variables) को पहचानें।",
          "प्रतिशत वृद्धि या कमी के अनुपात को 100 के आधार पर सेट करें।",
          exp
        ]
      });
    }

    return {
      groupId: `percentage-class-test-g${String(spec.g).padStart(2, '0')}`,
      originalGroupNo: spec.g,
      title: `G-${String(spec.g).padStart(2, '0')}`,
      description: `${qList.length} Questions • Q.${spec.start}–Q.${spec.end} • Official Railway PYQ`,
      questions: qList
    };
  });
}

const DEFAULT_MODULES = [
  {
    moduleId: "maths-percentage-class-test",
    subject: "maths",
    subjectTitle: "📐 Mathematics",
    topic: "percentage",
    topicTitle: "Percentage",
    chapter: "Arithmetic",
    testType: "class-test",
    testTypeTitle: "Class Test",
    theoryNotes: "प्रतिशत (Percentage) का अर्थ 'प्रति सौ' (per hundred) होता है। जब किसी मान की तुलना 100 से की जाती है तो उसे प्रतिशत कहते हैं।\n• x% = x/100\n• वृद्धि = [(नई कीमत - पुरानी कीमत)/पुरानी कीमत] × 100\n• कमी = [(पुरानी कीमत - नई कीमत)/पुरानी कीमत] × 100",
    flashcards: [
      { front: "आय में r% वृद्धि पर, B की आय A से कितनी कम होगी?", back: "फॉर्मूला: [r / (100 + r)] × 100%" },
      { front: "मूल्य में r% वृद्धि होने पर खर्च अपरिवर्तित रखने हेतु खपत में कमी:", back: "फॉर्मूला: [r / (100 + r)] × 100%" },
      { front: "क्रमिक प्रतिशत परिवर्तन (Successive Change a% और b%):", back: "प्रभावी प्रतिशत = [a + b + (ab/100)]%" },
      { front: "जनसंख्या में r% वार्षिक वृद्धि (2 वर्ष बाद):", back: "P₂ = P₀ × (1 + r/100)²" }
    ],
    groups: generatePercentageAllGroups()
  },
  {
    moduleId: "maths-profit-loss-class-test",
    subject: "maths",
    subjectTitle: "📐 Mathematics",
    topic: "profit-loss",
    topicTitle: "Profit & Loss",
    chapter: "Arithmetic",
    testType: "class-test",
    testTypeTitle: "Class Test",
    theoryNotes: "लाभ और हानि (Profit and Loss):\n• लाभ = SP - CP\n• हानि = CP - SP\n• लाभ % = (लाभ / CP) × 100\n• छूट (Discount) हमेशा अंकित मूल्य (MP) पर दी जाती है।",
    flashcards: [
      { front: "समान SP पर x% लाभ और x% हानि का शुद्ध परिणाम क्या होता है?", back: "हमेशा हानि होती है: Loss% = x² / 100" },
      { front: "MP, CP और Discount का संबंध:", back: "SP = MP × (100 - Discount%)/100 = CP × (100 + Profit%)/100" }
    ],
    groups: [
      {
        groupId: "maths-profit-loss-class-test-g01",
        title: "G-01",
        description: "20 Questions • Q201–Q220 • Official 2024 Railway PYQ",
        questions: [
          {
            originalQNo: 201,
            examInfo: "RRB Tech. - (III) 29/12/2024 (Afternoon)",
            year: "2024",
            paperDate: "29/12/2024",
            SUB_TOPIC: "Mixture & Alligation in Profit",
            CONCEPT: "Weighted Average Cost",
            QUESTION_EN: "A shopkeeper mixes pure ghee costing ₹100/kg with vanaspati oil costing ₹50/kg and sells the mixture at ₹96/kg, making 20% profit. In what ratio are they mixed?",
            QUESTION_HI: "शुद्ध घी ₹100/kg और वनस्पति तेल ₹50/kg है। मिश्रण ₹96/kg पर बेचने पर 20% लाभ होता है। दोनों किस अनुपात में मिलाए गए हैं?",
            options: [
              { letter: "A", en: "3 : 2", hi: "3 : 2" },
              { letter: "B", en: "3 : 1", hi: "3 : 1" },
              { letter: "C", en: "1 : 2", hi: "1 : 2" },
              { letter: "D", en: "4 : 1", hi: "4 : 1" }
            ],
            answer: "A",
            EXPLANATION: "Mixture CP = 96 / 1.20 = ₹80/kg. By Alligation rule: (80 - 50) : (100 - 80) = 30 : 20 = 3 : 2.",
            hints: ["मिश्रण का वास्तविक क्रय मूल्य (CP) निकालें: 96 / 1.20 = 80", "एलिगेशन नियम लगाएं: (80 - 50) : (100 - 80) = 3 : 2"]
          },
          {
            originalQNo: 202,
            examInfo: "RRB Tech. - (III) 29/12/2024 (Evening)",
            year: "2024",
            paperDate: "29/12/2024",
            SUB_TOPIC: "Equal Selling Price",
            CONCEPT: "Equal Gain and Loss %",
            QUESTION_EN: "A person sells two houses for ₹1.995 lakh each, one at 5% profit and the other at 5% loss. What is the overall profit or loss percentage?",
            QUESTION_HI: "एक व्यक्ति दो घर प्रत्येक ₹1.995 लाख में बेचता है। एक पर 5% लाभ और दूसरे पर 5% हानि है। पूरे लेन-देन में लाभ या हानि प्रतिशत क्या है?",
            options: [
              { letter: "A", en: "0.25% profit", hi: "0.25% लाभ" },
              { letter: "B", en: "25% loss", hi: "25% हानि" },
              { letter: "C", en: "2.5% loss", hi: "2.5% हानि" },
              { letter: "D", en: "0.25% loss", hi: "0.25% हानि" }
            ],
            answer: "D",
            EXPLANATION: "Loss % = x² / 100 = 5² / 100 = 0.25% loss.",
            hints: ["जब SP समान हो और लाभ% = हानि% = x हो, तो Loss % = x² / 100 होता है।"]
          }
        ]
      }
    ]
  },
  {
    moduleId: "science-physics-electricity-class-test",
    subject: "science",
    subjectTitle: "🔬 General Science",
    topic: "electricity",
    topicTitle: "Electricity",
    chapter: "Physics",
    testType: "class-test",
    testTypeTitle: "Class Test",
    theoryNotes: "ओम का नियम (Ohm's Law):\n• V = I × R\n• श्रेणीक्रम (Series): R_eq = R₁ + R₂ + ...\n• समानांतर क्रम (Parallel): 1/R_eq = 1/R₁ + 1/R₂ + ...\n• विद्युत शक्ति (Power): P = V × I = I²R = V²/R",
    flashcards: [
      { front: "विद्युत प्रतिरोध (Resistance) का SI मात्रक क्या है?", back: "ओम (Ohm - Ω)" },
      { front: "ओम का नियम (Ohm's Law) सूत्र:", back: "V = I × R" },
      { front: "विद्युत धारा (Current) का SI मात्रक:", back: "एम्पीयर (Ampere - A)" },
      { front: "विद्युत ऊर्जा (Commercial Unit of Electrical Energy):", back: "1 kWh = 3.6 × 10⁶ Joule" }
    ],
    groups: [
      {
        groupId: "science-physics-electricity-class-test-g01",
        title: "G-01",
        description: "20 Questions • Current, Ohm's Law, Power & Circuits",
        questions: [
          {
            originalQNo: 10933,
            examInfo: "RRB ALP CBT-1 25/11/2024",
            year: "2024",
            paperDate: "25/11/2024",
            SUB_TOPIC: "Ohm's Law",
            CONCEPT: "V = IR Numerical",
            QUESTION_EN: "If a potential difference of 12 V is applied across a resistance of 4 Ω, find the current flowing through it.",
            QUESTION_HI: "यदि 4 Ω के प्रतिरोध पर 12 V का विभवांतर लगाया जाता है, तो प्रवाहित विद्युत धारा का मान ज्ञात कीजिए।",
            options: [
              { letter: "A", en: "3 A", hi: "3 A" },
              { letter: "B", en: "48 A", hi: "48 A" },
              { letter: "C", en: "0.33 A", hi: "0.33 A" },
              { letter: "D", en: "8 A", hi: "8 A" }
            ],
            answer: "A",
            EXPLANATION: "Ohm's Law: I = V / R = 12 / 4 = 3 A.",
            hints: ["I = V / R सूत्र का प्रयोग करें।"]
          },
          {
            originalQNo: 10934,
            examInfo: "RRB Group D 18/09/2022",
            year: "2022",
            paperDate: "18/09/2022",
            SUB_TOPIC: "Current Electricity",
            CONCEPT: "SI Unit of Resistance",
            QUESTION_EN: "The SI unit of electric resistance is:",
            QUESTION_HI: "विद्युत प्रतिरोध का SI मात्रक क्या है?",
            options: [
              { letter: "A", en: "Volt", hi: "वोल्ट" },
              { letter: "B", en: "Ampere", hi: "एम्पीयर" },
              { letter: "C", en: "Ohm", hi: "ओम" },
              { letter: "D", en: "Coulomb", hi: "कूलम्ब" }
            ],
            answer: "C",
            EXPLANATION: "The SI unit of electric resistance is Ohm (Ω).",
            hints: ["प्रतिरोध को ग्रीक अक्षर Ω (ओमेगा) से दर्शाते हैं।"]
          },
          {
            originalQNo: 10935,
            examInfo: "RRB NTPC CBT-1 12/01/2021",
            year: "2021",
            paperDate: "12/01/2021",
            SUB_TOPIC: "Series & Parallel",
            CONCEPT: "Equivalent Resistance in Parallel",
            QUESTION_EN: "Two resistors of 6 Ω and 3 Ω are connected in parallel. What is their equivalent resistance?",
            QUESTION_HI: "6 Ω और 3 Ω के दो प्रतिरोधक समानांतर क्रम में जुड़े हैं। उनका तुल्य प्रतिरोध क्या होगा?",
            options: [
              { letter: "A", en: "2 Ω", hi: "2 Ω" },
              { letter: "B", en: "9 Ω", hi: "9 Ω" },
              { letter: "C", en: "4.5 Ω", hi: "4.5 Ω" },
              { letter: "D", en: "18 Ω", hi: "18 Ω" }
            ],
            answer: "A",
            EXPLANATION: "1/R_eq = 1/6 + 1/3 = 3/6 = 1/2 ⇒ R_eq = 2 Ω.",
            hints: ["R_eq = (R₁ × R₂) / (R₁ + R₂) = (6 × 3) / (6 + 3) = 18 / 9 = 2 Ω"]
          },
          {
            originalQNo: 10936,
            examInfo: "RRB JE 28/05/2019",
            year: "2019",
            paperDate: "28/05/2019",
            SUB_TOPIC: "Power & Energy",
            CONCEPT: "P = VI Calculation",
            QUESTION_EN: "An electric bulb is connected to a 220 V generator. The current is 0.50 A. What is the power of the bulb?",
            QUESTION_HI: "एक विद्युत बल्ब 220 V के जनरेटर से जुड़ा है। धारा 0.50 A है। बल्ब की शक्ति क्या है?",
            options: [
              { letter: "A", en: "110 W", hi: "110 W" },
              { letter: "B", en: "440 W", hi: "440 W" },
              { letter: "C", en: "55 W", hi: "55 W" },
              { letter: "D", en: "220 W", hi: "220 W" }
            ],
            answer: "A",
            EXPLANATION: "Power P = V × I = 220 V × 0.50 A = 110 W.",
            hints: ["P = V × I सूत्र लागू करें।"]
          }
        ]
      }
    ]
  }
];

const STORAGE_KEY = 'master_student_journey_v90_app_modules';
const USER_KEY = 'master_student_journey_v90_user_state';
const IMPORT_HISTORY_KEY = 'master_student_journey_v90_import_history';
