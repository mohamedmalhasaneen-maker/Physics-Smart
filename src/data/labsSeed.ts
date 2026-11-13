import { LabExperimentConfig } from '../types/physics';

export const LAB_EXPERIMENTS: LabExperimentConfig[] = [
  {
    id: 'lab-linear-freefall',
    category: 'mechanics',
    simKey: 'linear_freefall',
    titleAr: 'الحركة في خط مستقيم والسقوط الحر',
    titleEn: 'Linear Motion & Free Fall',
    descriptionAr:
      'اختبر حركة جسم يسقط حرًا أو يتحرك بعجلة منتظمة، وراقب تغير السرعة والإزاحة لحظيًا مع رسم بياني مباشر للسرعة والزمن.',
    descriptionEn:
      'Simulate vertical free fall and uniform linear acceleration while observing real-time velocity vectors and live v-t / y-t graphs.',
    equationsLatex: ['y(t) = v_0 t + \\frac{1}{2} g t^2', 'v(t) = v_0 + g t', 'v^2 = v_0^2 + 2 g y'],
    procedureAr: [
      'اضبط الارتفاع الابتدائي والسرعة الابتدائية وعجلة الجاذبية (الأرض 9.81 أو القمر 1.62 م/ث²).',
      'اضغط تشغيل لمراقبة سقوط الجسم وتزايد متجه السرعة خطيًا مع الزمن.',
      'راقب الرسم البياني (v-t) وتحقق أن ميل الخط المستقيم يساوي عجلة الجاذبية g.',
    ],
    procedureEn: [
      'Set initial height, initial velocity, and gravitational field g (Earth 9.81 m/s² or Moon 1.62 m/s²).',
      'Press Play to observe the object falling and the velocity vector growing linearly over time.',
      'Inspect the live v-t plot and verify that its slope equals the gravitational acceleration g.',
    ],
    scientificExplanationAr:
      'في غياب مقاومة الهواء، تسقط جميع الأجسام بنفس العجلة الثابتة g بغض النظر عن كتلتها. يتزايد تغير المسافة تربيعيًا مع الزمن بينما تتزايد السرعة خطيًا.',
    scientificExplanationEn:
      'Neglecting air drag, all objects fall with identical constant acceleration g regardless of mass. Position grows quadratically with t while velocity grows linearly.',
    postQuestions: [
      {
        qAr: 'عند مضاعفة زمن السقوط الحر من السكون (t → 2t)، فإن المسافة المقطوعة:',
        qEn: 'When free-fall time from rest doubles (t → 2t), the distance fallen:',
        optionsAr: ['تتضاعف مرتين', 'تزداد 4 أضعاف', 'تبقى ثابتة'],
        optionsEn: ['Doubles', 'Quadruples (4x)', 'Stays constant'],
        correctIndex: 1,
        reasonAr: 'لأن d = ½ g t² تتناسب طرديًا مع مربع الزمن.',
        reasonEn: 'Because d = ½ g t² is proportional to t².',
      },
    ],
  },
  {
    id: 'lab-projectile',
    category: 'mechanics',
    simKey: 'projectile',
    titleAr: 'المقذوفات بزاوية (Projectile Motion)',
    titleEn: '2D Projectile Motion Lab',
    descriptionAr:
      'أطلق مقذوفًا بسرعة وزاوية قابلة للتعديل، واستكشف استقلالية المركبة الأفقية للسرعة (vₓ ثابتة) والمركبة الرأسية (vᵧ متغيرة).',
    descriptionEn:
      'Launch a projectile with adjustable speed, angle, and gravity. Observe independent horizontal constant velocity and vertical accelerated motion.',
    equationsLatex: [
      'x(t) = (v_0 \\cos\\theta) t',
      'y(t) = (v_0 \\sin\\theta) t - \\frac{1}{2} g t^2',
      'R = \\frac{v_0^2 \\sin(2\\theta)}{g}',
    ],
    procedureAr: [
      'اختر سرعة الإطلاق v₀ وزاوية الإطلاق θ.',
      'شغّل المحاكاة وراقب مركبتي السرعة الخضراء والزرقاء عند أقصى ارتفاع.',
      'جرّب الزاوية 45° مقارنةً بـ 30° و60° وتحقق من تساوي المدى الأفقي للزاويتين المتتامتين.',
    ],
    procedureEn: [
      'Adjust launch speed v₀ and launch angle θ.',
      'Run the simulation and observe horizontal vs vertical velocity components at peak height.',
      'Compare 45° (maximum range) with complementary angles 30° and 60°.',
    ],
    scientificExplanationAr:
      'تتكون حركة المقذوف من حركتين مستقلتين: حركة أفقية بسرعة منتظمة لأن Fx = 0، وحركة رأسية بعجلة الجاذبية -g. عند أقصى ارتفاع تصبح vᵧ = 0 بينما تظل vₓ ثابتة.',
    scientificExplanationEn:
      'Projectile motion combines constant-velocity horizontal motion (aₓ = 0) with constant-acceleration vertical motion (aᵧ = -g). At apex, vᵧ = 0 while vₓ remains nonzero.',
    postQuestions: [
      {
        qAr: 'ما مقدار السرعة الرأسية vᵧ عند أقصى ارتفاع يصل إليه المقذوف؟',
        qEn: 'What is the vertical velocity component vᵧ at the maximum height?',
        optionsAr: ['تساوي v₀', 'تساوي صفرًا', 'تساوي 9.8 م/ث'],
        optionsEn: ['Equals v₀', 'Equals zero', 'Equals 9.8 m/s'],
        correctIndex: 1,
        reasonAr: 'يتوقف المقذوف لحظيًا عن الصعود عند القمة فتصبح vᵧ = 0.',
        reasonEn: 'At the peak, upward motion momentarily stops so vᵧ = 0.',
      },
    ],
  },
  {
    id: 'lab-newton-incline',
    category: 'mechanics',
    simKey: 'newton_incline',
    titleAr: 'قوانين نيوتن والاحتكاك على سطح مائل',
    titleEn: "Newton's Laws & Inclined Plane Friction",
    descriptionAr:
      'حلّل قوى الوزن والعمودية والاحتكاك الحركي على مستوى مائل متغير الزاوية ومعامل الاحتكاك μₖ.',
    descriptionEn:
      'Decompose gravitational weight, normal reaction, and kinetic friction on an adjustable inclined ramp with live acceleration output.',
    equationsLatex: [
      'N = m g \\cos\\theta',
      'f_k = \\mu_k N = \\mu_k m g \\cos\\theta',
      'a = g (\\sin\\theta - \\mu_k \\cos\\theta)',
    ],
    procedureAr: [
      'غيّر زاوية ميل السطح θ ومعامل الاحتكاك μₖ.',
      'لاحظ تغير طول سهم قوة الاحتكاك fₖ ومركبة الوزن الموازية للسطح mg sin(θ).',
      'ابحث عن الزاوية الحرجة التي يبدأ عندها الجسم بالانزلاق عندما tan(θ) > μₖ.',
    ],
    procedureEn: [
      'Vary ramp angle θ and kinetic friction coefficient μₖ.',
      'Observe force vectors: mg sin(θ) down the ramp vs kinetic friction fₖ opposing motion.',
      'Find the threshold angle where sliding begins when tan(θ) > μₖ.',
    ],
    scientificExplanationAr:
      'يتسارع الجسم للأسفل فقط إذا تغلبت مركبة الوزن الموازية للسطح (mg sin θ) على قوة الاحتكاك القصوى (μ N). العجلة الناتجة مستقلة تمامًا عن كتلة الجسم.',
    scientificExplanationEn:
      'The block accelerates down-ramp only if mg sin(θ) exceeds friction μₖ mg cos(θ). Notice that mass cancels out from the acceleration equation!',
    postQuestions: [
      {
        qAr: 'إذا تضاعفت كتلة الجسم على سطح مائل أملس (μ = 0)، ماذا يحدث للعجلة؟',
        qEn: 'If mass doubles on a frictionless ramp (μ = 0), what happens to acceleration?',
        optionsAr: ['تتضاعف', 'تقل للنصف', 'تبقى ثابتة'],
        optionsEn: ['Doubles', 'Halves', 'Remains unchanged'],
        correctIndex: 2,
        reasonAr: 'لأن a = g sin θ لا تعتمد على الكتلة m.',
        reasonEn: 'Because a = g sin θ is independent of mass m.',
      },
    ],
  },
  {
    id: 'lab-collisions',
    category: 'mechanics',
    simKey: 'collisions',
    titleAr: 'التصادمات المرنـة وغير المرنة وحفظ كمية التحرك',
    titleEn: 'Elastic & Inelastic Collisions (Momentum & Energy)',
    descriptionAr:
      'اضبط كتلتي وسرعتي جسمين ومعامل الارتداد e (من 0 غير مرن تمامًا إلى 1 مرن تمامًا) وراقب حفظ كمية التحرك وطاقة الحركة.',
    descriptionEn:
      'Collide two carts with adjustable masses, velocities, and restitution coefficient e (0 = perfectly inelastic, 1 = elastic) while verifying momentum & KE.',
    equationsLatex: [
      'm_1 v_1 + m_2 v_2 = m_1 v_1\' + m_2 v_2\'',
      'e = \\frac{v_2\' - v_1\'}{v_1 - v_2}',
      'KE_{\\text{total}} = \\frac{1}{2} m_1 v_1^2 + \\frac{1}{2} m_2 v_2^2',
    ],
    procedureAr: [
      'اضبط m₁ و m₂ والسرعات الابتدائية v₁ و v₂.',
      'اختبر التصادم المرن (e = 1) ثم التصادم غير المرن (e = 0).',
      'قارن مجموع كمية التحرك ومجموع طاقة الحركة قبل التصادم وبعده في لوحة القراءات.',
    ],
    procedureEn: [
      'Configure masses m₁, m₂ and initial velocities v₁, v₂.',
      'Compare perfectly elastic (e = 1) vs perfectly inelastic (e = 0) collisions.',
      'Verify that total momentum stays constant in all cases while KE is conserved only when e = 1.',
    ],
    scientificExplanationAr:
      'في غياب قوى خارجية، تظل كمية التحرك الكلية محفوظة دائمًا، بينما تُفقد جزء من طاقة الحركة على شكل حرارة وصوت في التصادم غير المرن.',
    scientificExplanationEn:
      'With no external net force, total momentum is strictly conserved in every collision, whereas kinetic energy is conserved only in perfectly elastic collisions (e = 1).',
    postQuestions: [
      {
        qAr: 'أي كمية تظل محفوظة دائمًا في التصادم غير المرن في نظام معزول؟',
        qEn: 'Which quantity is always conserved in an isolated inelastic collision?',
        optionsAr: ['طاقة الحركة فقط', 'كمية التحرك الكلية', 'السرعة النسبية'],
        optionsEn: ['Kinetic Energy only', 'Total Linear Momentum', 'Relative Speed'],
        correctIndex: 1,
        reasonAr: 'كمية التحرك الكلية محفوظة في جميع أنواع التصادمات المعزولة.',
        reasonEn: 'Total momentum is conserved in all isolated collisions.',
      },
    ],
  },
  {
    id: 'lab-ohms-circuits',
    category: 'electricity',
    simKey: 'ohms_circuits',
    titleAr: 'قانون أوم والتوصيل على التوالي والتوازي والقدرة',
    titleEn: "Ohm's Law, Series/Parallel Circuits & Power",
    descriptionAr:
      'صمّم دائرة كهربية بتوصيل توالي أو توازي، غيّر الجهد V والمقاومات R₁ و R₂، وشاهد حركة الإلكترونات ومنحنى I-V المباشر.',
    descriptionEn:
      'Switch between Series and Parallel topologies, tune V, R₁, and R₂, and observe real-time electron drift speed, branch currents, power dissipation, and I-V plot.',
    equationsLatex: [
      'I = \\frac{V}{R_{eq}}',
      'R_{\\text{series}} = R_1 + R_2 \\quad , \\quad \\frac{1}{R_{\\text{parallel}}} = \\frac{1}{R_1} + \\frac{1}{R_2}',
      'P = V I = I^2 R_{eq}',
    ],
    procedureAr: [
      'اختر نوع التوصيل: توالي (Series) أو توازي (Parallel).',
      'عدّل جهد البطارية V وقيم المقاومتين R₁ و R₂.',
      'راقب كيف تنخفض المقاومة المكافئة في التوازي ويزداد التيار الكلي والقدرة المستهلكة.',
    ],
    procedureEn: [
      'Toggle circuit topology between Series and Parallel.',
      'Adjust battery EMF V and resistor values R₁ and R₂.',
      'Observe how parallel wiring lowers equivalent resistance and boosts total current and power.',
    ],
    scientificExplanationAr:
      'في التوصيل على التوالي يمر نفس التيار في كل مقاومة ويتجزأ الجهد، بينما في التوازي يتساوى فرق الجهد ويتجزأ التيار فتكون المقاومة المكافئة أصغر من أصغر مقاومة.',
    scientificExplanationEn:
      'In series, current is identical through all resistors and voltage divides; in parallel, voltage is equal across branches and current splits, yielding R_eq smaller than the smallest resistor.',
    postQuestions: [
      {
        qAr: 'مقاومتان 6 Ω و 3 Ω موصلتان على التوازي، فما مقاومتهما المكافئة؟',
        qEn: 'What is the equivalent resistance of 6 Ω and 3 Ω connected in parallel?',
        optionsAr: ['9 Ω', '2 Ω', '4.5 Ω'],
        optionsEn: ['9 Ω', '2 Ω', '4.5 Ω'],
        correctIndex: 1,
        reasonAr: 'R_eq = (6 × 3) / (6 + 3) = 18 / 9 = 2 Ω.',
        reasonEn: 'R_eq = (6 × 3) / (6 + 3) = 18 / 9 = 2 Ω.',
      },
    ],
  },
  {
    id: 'lab-waves-interference',
    category: 'waves',
    simKey: 'waves_interference',
    titleAr: 'الموجات المستعرضة والطولية والتداخل الموجي',
    titleEn: 'Transverse/Longitudinal Waves & Interference',
    descriptionAr:
      'توليد موجات مستعرضة وطولية أو تداخل موجتين بتعديل السعة والتردد وفرق الطور، مع قياس الطول الموجي λ وسرعة الانتشار.',
    descriptionEn:
      'Switch between Transverse, Longitudinal compression waves, and Two-Wave Superposition to explore wavelength λ, frequency f, and constructive/destructive interference.',
    equationsLatex: ['y(x,t) = A \\sin(kx - \\omega t + \\phi)', 'v = \\lambda f', 'k = \\frac{2\\pi}{\\lambda}'],
    procedureAr: [
      'اختر نمط الموجة: مستعرضة أو طولية أو تداخل موجتين.',
      'غيّر التردد f والسعة A وفرق الطور φ.',
      'تحقق من حدوث التداخل الهدام التام عندما يكون فرق الطور 180° وتساوي السعتين.',
    ],
    procedureEn: [
      'Select wave mode: Transverse, Longitudinal, or Interference.',
      'Adjust frequency f, amplitude A, and phase offset φ.',
      'Verify complete destructive interference when phase difference reaches 180° with equal amplitudes.',
    ],
    scientificExplanationAr:
      'عند تداخل موجتين في نفس الوسط، تكون الإزاحة المحصلة مساوية للمجموع الجبري لإزاحتي الموجتين (مبدأ التراكب).',
    scientificExplanationEn:
      'By the superposition principle, the net wave displacement at any point equals the algebraic sum of the individual overlapping waves.',
    postQuestions: [
      {
        qAr: 'يحدث تداخل هدام تام بين موجتين متساويتين في السعة عندما يكون فرق الطور بينهما:',
        qEn: 'Complete destructive interference between two equal-amplitude waves occurs at phase difference:',
        optionsAr: ['0°', '90°', '180°'],
        optionsEn: ['0°', '90°', '180°'],
        correctIndex: 2,
        reasonAr: 'عند 180° (π rad) تلتقي القمة مع القاع فيلغيان بعضهما.',
        reasonEn: 'At 180° (π rad), crests align with troughs and cancel.',
      },
    ],
  },
  {
    id: 'lab-magnetism-induction',
    category: 'magnetism',
    simKey: 'magnetism_induction',
    titleAr: 'القوة المغناطيسية والحث الكهرومغناطيسي (فاراداي)',
    titleEn: "Lorentz Magnetic Force & Faraday's Induction",
    descriptionAr:
      'استكشف حركة شحنة في مجال مغناطيسي منتظم (مسار دائري) وكذلك تجربة فاراداي لتحريك مغناطيس داخل ملف لولبي مع قراءة الجلفانومتر.',
    descriptionEn:
      'Toggle between Lorentz cyclotron motion of a charge in a B-field and Faraday electromagnetic induction with a moving magnet and live EMF galvanometer.',
    equationsLatex: ['F = q v B \\sin\\theta', 'r = \\frac{m v}{q B}', '\\mathcal{E} = -N \\frac{d\\Phi_B}{dt}'],
    procedureAr: [
      'اختر تجربة لورنتز للشحنة أو تجربة الحث لفاراداي.',
      'في الحث: غيّر سرعة حركة المغناطيس وعدد لفات الملف N وراقب انحراف مؤشر الجلفانومتر.',
      'في لورنتز: عدّل شدة المجال B وسرعة الشحنة v ولاحظ تغير نصف قطر المسار الدائري r.',
    ],
    procedureEn: [
      'Choose between Lorentz Charge Deflection and Faraday Coil Induction.',
      'In Faraday mode: change magnet speed and coil turns N and watch the galvanometer needle.',
      'In Lorentz mode: vary B-field strength and velocity v to see cyclotron radius r = mv/(qB).',
    ],
    scientificExplanationAr:
      'القوة المغناطيسية عمودية دائمًا على السرعة فتعمل كقوة جاذبة مركزية دون تغيير مقدار السرعة. وفي الحث، يتناسب مقدار ق.د.ك المستحثة طرديًا مع معدل تغير الفيض.',
    scientificExplanationEn:
      'Magnetic force acts perpendicular to velocity, curving the trajectory without doing work. In induction, EMF magnitude is proportional to the rate of flux change.',
    postQuestions: [
      {
        qAr: 'إذا توقف المغناطيس تمامًا داخل الملف (السرعة = 0)، فإن القوة الدافعة المستحثة تساوي:',
        qEn: 'If the magnet sits completely stationary inside the coil, the induced EMF is:',
        optionsAr: ['قيمة عظمى', 'صفرًا', 'نصف القيمة العظمى'],
        optionsEn: ['Maximum', 'Zero', 'Half maximum'],
        correctIndex: 1,
        reasonAr: 'لأن معدل تغير الفيض المغناطيسي dΦ/dt = 0 عند السكون.',
        reasonEn: 'Because the rate of flux change dΦ/dt = 0 when stationary.',
      },
    ],
  },
  {
    id: 'lab-optics-bench',
    category: 'optics',
    simKey: 'optics_bench',
    titleAr: 'البصريات الهندسية: العدسات والمرايا والانكسار',
    titleEn: 'Geometric Optics: Lenses, Mirrors & Snell Refraction',
    descriptionAr:
      'منضدة بصرية تفاعلية لتتبع الأشعة الضوئية وتكوين الصور في العدسات المحدبة والمقعرة والمرايا، بالإضافة إلى الانكسار والانعكاس الكلي.',
    descriptionEn:
      'Interactive optical bench tracing principal rays for converging/diverging lenses and mirrors, plus Snell’s law refraction and total internal reflection.',
    equationsLatex: ['\\frac{1}{f} = \\frac{1}{d_o} + \\frac{1}{d_i}', 'M = -\\frac{d_i}{d_o}', 'n_1 \\sin\\theta_1 = n_2 \\sin\\theta_2'],
    procedureAr: [
      'اختر الوضع البصري: عدسة محدبة، عدسة مقعرة، أو قانون سنل للانكسار.',
      'حرّك بعد الجسم d₀ والبعد البؤري f وشاهد تكون الصورة الحقيقية المقلوبة أو التقديرية المعتدلة.',
      'في وضع سنل: ارفع زاوية السقوط من الزجاج إلى الهواء لتتجاوز الزاوية الحرجة θc وشاهد الانعكاس الكلي الداخلي.',
    ],
    procedureEn: [
      'Select mode: Converging Lens, Diverging Lens, or Snell Refraction.',
      'Adjust object distance d₀ and focal length f to watch real vs virtual image formation.',
      'In Snell mode: exceed the critical angle θc from glass to air to trigger Total Internal Reflection.',
    ],
    scientificExplanationAr:
      'عند وضع الجسم على مسافة أكبر من البعد البؤري لعدسة محدبة تتكون صورة حقيقية مقلوبة، بينما إذا قَرُب من البؤرة (d₀ < f) تصبح الصورة تقديرية معتدلة مكبرة.',
    scientificExplanationEn:
      'For a converging lens, placing an object beyond f forms a real inverted image, while placing it inside f produces a magnified upright virtual image.',
    postQuestions: [
      {
        qAr: 'تتكون صورة تقديرية معتدلة مكبرة بواسطة عدسة محدبة عندما يكون الجسم:',
        qEn: 'A converging lens forms a magnified upright virtual image when the object is:',
        optionsAr: ['أبعد من ضعف البعد البؤري', 'على مسافة أقل من البعد البؤري (d₀ < f)', 'عند البؤرة تمامًا'],
        optionsEn: ['Beyond 2f', 'Closer than focal length (d₀ < f)', 'Exactly at f'],
        correctIndex: 1,
        reasonAr: 'تتفرق الأشعة المنكسرة فتلتقي امتداداتها خلف العدسة لتكوين صورة مكبرة معتدلة.',
        reasonEn: 'Refracted rays diverge and their virtual extensions meet on the object side.',
      },
    ],
  },
];
