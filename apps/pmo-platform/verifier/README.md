# Verifier index

## v1 (2026-09-24) — переход на 3 клика + осмысленные матрёшки
Критерии:
1. landing.html не содержит «два клика»/«2 клика»/«двух кликов» (кроме verifier/).
2. «три клика» присутствует минимум в hero, карточке 03 и абзаце под схемой; все упоминания — ссылки на #live.
3. Схема: 5 кукол убывают слева направо; подписи L0–L4; бейджи «клик 1/2/3» у L1/L2/L3; нет ленты; визуальная семантика каждой куклы (L0 каналы, L1 дайджест-фильтр, L2 реестр рисков с предупреждением, L3 решение-чеклист+кнопка, L4 поручение с ответственным) — визуальная проверка скриншотом.
4. Живой пример: 3 последовательных клика (открыть риск из дайджеста → подтвердить фиксацию риска → принять/обсудить/отклонить решение), карточки справа меняются на каждом шаге; телефон фиксированной высоты, скролл внутри.
5. Карточки под схемой соответствуют новому порядку L0–L4 с историей Иванова; чипы внизу слева.
6. Скриншоты desktop+mobile без регрессий; git commit; build_version.
Отличия от прежних проверок: новая логика уровней и 3 клика вместо 2.

## v2 (2026-09-24) — фикс измерения ссылок
Критерии те же, что в v1. Исправлена проверка «три клика — ссылка на #live»: окно поиска открывающего тега <a> увеличено со 120 до 260 символов (длинный inline-style у ссылки давал ложное срабатывание).

## v3 — 2026-09-24T15:5xZ
- mobile matryoshka: vertical strip L0 top + card right of each doll
- measures: doll slices exist & referenced once; mpairs 5 rows L0-L4 img/card match; mobile CSS hides scheme/lcards/swipe-hint, shows mpairs; desktop scheme intact
- differs from v2: adds mobile-layout structural checks

## v4 — 2026-09-24T16:4xZ
- mobile rows rebuilt: true-size dolls (heights 585/471/433/397/337) + nested outlines of previous dolls (L0 none, L4 four), RGBA transparent bg (site cream shows through)
- measures: RGBA+transparent corners; uniform canvas; outline px strictly increasing 0<..<42892; doll heights strictly decreasing; HTML wiring (mrow refs, mcap captions, mdoll CSS); v2 regression
- supersedes v3 artifacts: doll-lN.png slices removed (v3 kept for history, not re-run)

## v5 — 2026-09-24T18:1xZ
- rows rebuilt: all dolls recolored to L0 indigo (histogram match; L4 body/ornament inversion), outlines = clean outer contour of filled silhouettes (no ornament pattern), L1 +8%, captions removed
- measures: outline px increasing 0<3881<6407<8732<10855; heights 585>509>433>397>337; L1/L0=0.87; median doll color == L0 within tol; no mcap in HTML
- supersedes v4 (captions removed per user; outlines restyled)

## v6 — 2026-09-24T18:5xZ
- uniform outline spacing: doll sizes scaled to equal (h+w) steps -> heights 586/540/470/407/337, radial gaps uniform (~102px h+w)
- measures: radial gap uniformity (dh+dw within 10px), min gaps, plus v5 checks still apply

## v7 — 2026-09-24T22:1xZ
- down-chevrons between mobile cards: 4 mchev divs alternating mpair rows, accent color, card-column centered, desktop-hidden
- measures: count==4, CSS rules, exact mpair/mchev alternation sequence

## v8 — 2026-09-25T09:0xZ
- workspace bot avatar: matryoshka face cropped from matreshka-hero.png (expression untouched), 256px, replaces text "AI" in bot template + welcomeHTML; user avatar КП kept; accent ring kept via CSS
- measures: file exists 256x256, markup x2, no stale AI text avatar, CSS img rule, КП intact

## v9 — 2026-09-26T19:4xZ
- изменение: журнал проблем (issue log) удалён из прототипа; наступившие риски остаются в реестре рисков со статусом вероятности «активный» (наряду с «высокая/средняя/низкая»)
- measures: сайдбар без пункта «Проблемы»; полное удаление кода issues (view, tabs, PROPS.issues, applyProposal, счётчики); нет ID I-xxx; селекты вероятности + бейджи с «активный» (класс .tk-st.live); RISKS содержит R-102/R-106/R-107 с prob=активный; предложение I-005 мигрировано в R-105; перекрёстные ссылки S-06/S-07 → R-102/R-107; бейдж источника ch-reg; синтаксис JS; один </html>; визуальная проверка скриншотами (desktop сайдбар + реестр рисков)
- differs from v8: предметная область — реестры воркспейса (index.html), а не лендинг

## v10 — 2026-09-26T21:0xZ
- аудит без изменений кода: запрос «механика предложений ИИ и доверие» (7 пунктов) сверен с прототипом — все пункты уже реализованы
- measures: наличие srcBadgeHTML/srcPop (кликабельный источник), CH_BADGE 4 каналов, diff-паттерн P-08→P-04 (18.09→22.09), дедупликация P-09≈P-06 92% + propMerge, «Почему предлагает»+эффект во всех реестрах, USER_ROLE с блокировкой не-РП; экран Решений не тронут
- отмечен нюанс: roleSwitchHTML() определён, но не смонтирован; форма п.1 — бейдж+попап, не полнотекстовая ссылка
- differs from v9: проверка существующей реализации (audit-only), код не изменялся

## v11 — 2026-09-26T21:1xZ
- изменение: демо-переключатель роли (roleSwitchHTML) смонтирован в шапки реестров Поручения/Риски/Стейкхолдеры; Решения не тронуты; ответы пользователя «без предпочтений» → п.1 оставлен как бейдж+попап
- measures: v10-проверки (7 пунктов) + переключатель смонтирован ровно в 3 реестрах, CSS .role-sw, синтаксис JS, скриншот роли «участник» с заблокированными ✓/✕/✎
- differs from v10: код изменён (монтирование переключателя), критерий «не смонтирован» заменён на «смонтирован ×3»

## v12 — 2026-09-30T14:1xZ
- изменение: новый вариант лендинга landing-b.html по брифу UX/UI (сокращение контента, одна схема, один CTA); landing.html и index.html не тронуты — текущая опубликованная версия остаётся активной для сравнения
- measures: hero/CTA/подпись альфы по брифу; объём текста 47% от текущего (цель −50–60%); одна схема matreshka-full-cycle, без дублей L0–L4; демо #live с рабочими кнопками (клик-тест playwright: open→confirm→accept, 0 ошибок JS); один доминирующий CTA ×2 (hero+финал) → index.html; запрещённые обещания отсутствуют; 3 пункта проблема→результат; 4 направления возможностей; mobile+desktop скриншоты
- differs from v11: предмет — новый файл landing-b.html, проверки по критериям приёмки брифа

## v13 — 2026-10-19T20:0xZ
- изменение: переработана только иллюстрация «Полный цикл управления риском» в landing.html — вместо PNG теперь HTML/SVG: 5 матрёшек единой системы с разными метафорами (поток/фильтр/риск/решение/поручения) и янтарной нитью передачи контекста (сообщение → сигнал → риск → решение); остальные секции, тексты и демо не тронуты
- measures: 5 матрёшек/общий symbol, подписи L0–L4, метафоры по брифу, 4 коннектора, caption без изменений, демо-JS цел, скриншоты desktop 1440 + mobile 390 (0 ошибок JS)
- differs from v12: предмет — иллюстрация цикла в основном landing.html, не объём контента

## v13 — 2026-10-19T20:0xZ
- изменение: переработана только иллюстрация «Полный цикл управления риском» в landing.html — вместо PNG теперь HTML/SVG: 5 матрёшек единой системы с разными метафорами (поток/фильтр/риск/решение/поручения) и янтарной нитью передачи контекста (сообщение → сигнал → риск → решение); остальные секции, тексты и демо не тронуты
- measures: 5 матрёшек/общий symbol, подписи L0–L4, метафоры по брифу, 4 коннектора, caption без изменений, демо-JS цел, скриншоты desktop 1440 + mobile 390 (0 ошибок JS)
- differs from v12: предмет — иллюстрация цикла в основном landing.html, не объём контента

## v14 — 2026-10-19T20:4xZ
- изменение: ОТКАТ v13 — в landing.html возвращена прежняя иллюстрация matreshka-full-cycle.png (и её CSS), SVG-цепочка удалена полностью; остальные секции не тронуты
- measures: PNG на месте, артефактов цепочки нет, hero/демо/подпись целы, скриншоты desktop+mobile, 0 ошибок JS

## v15 — 2026-10-24 — Product Contract: два клика, сквозные записи и независимые откаты
- изменение: лендинг переведён на open → accept без отдельного подтверждения фиксации; решение и поручение получили источник и атрибуцию. Воркспейс создаёт связанную запись L4, централизует права РП, честно маркирует интеграции, сохраняет demo-state локально и адаптирует реестры под 390 px. Эталонная композиция экрана решений и прежний PNG сохранены.
- measures: `v15/criteria.md`; статические проверки лендинга/воркспейса; Playwright desktop/mobile, РП/участник, reload, отсутствие JS errors и локальных 404; четыре состояния A/B/C/D с версиями и SHA-256 в `rollback/step2/states.json`.
- differs from v14: предмет — сквозная продуктовая логика и независимый откат компонентов, а не только иллюстрация.

## v16 — 2026-10-24 — production P0: серверные данные, права и audit trail
- изменение: существующий интерфейс перенесён без редизайна в full-stack проект; решения и связанные поручения сохраняются в MySQL, mutation разрешена только серверной роли РП, события цепочки видны в раскрываемом журнале. Лендинг и прежний PNG не изменены.
- measures: `v16/criteria.md`; HTTP 401/403/409; реальный клик РП и атомарное `D-02 → P-D-02`; persistence в новом контексте и после холодного production-запуска без `node_modules`; desktop/mobile Playwright, 0 JS errors и локальных 404.
- differs from v15: предмет — серверная persistence, аутентификация и атомарный audit trail вместо браузерного demo-state.
