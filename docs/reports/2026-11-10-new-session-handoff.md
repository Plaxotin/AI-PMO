# AI PMO — передача дел в новую ветку · 10.11.2026

## 1. Первое сообщение для новой ветки

Скопировать в новую сессию:

```text
Продолжай проект AI PMO в рабочей директории:
C:\Users\plaxo\OneDrive\Desktop\стартап AI PMO

Сначала прочитай:
1. _work/AI-PMO-main/AGENTS.md
2. _work/AI-PMO-main/docs/reports/2026-11-10-new-session-handoff.md
3. _work/AI-PMO-main/docs/reports/2026-11-10-wave-1-bl50-bl55-report.md

Не повторяй завершённые реализации и не меняй production.
Первая задача: проверить Notion через плагин в read-only режиме.
Затем покажи мне целевые страницы и точные создаваемые/изменяемые материалы из раздела 5 handoff.
Перед изменением существующих страниц или записей бэклога дождись моего отдельного подтверждения.
После публикации проверь фактические ссылки и зафиксируй результат синхронизации в GitHub.
Не используй браузер для записи в Notion и не выводи секреты, реальные chat/user IDs или spreadsheet ID.
```

## 2. Рабочие пути и источники истины

- Workspace: `C:\Users\plaxo\OneDrive\Desktop\стартап AI PMO`.
- Репозиторий: `C:\Users\plaxo\OneDrive\Desktop\стартап AI PMO\_work\AI-PMO-main`.
- GitHub: `Plaxotin/AI-PMO`, ветка `main`.
- На момент подготовки handoff GitHub `main`: `c83b063` — `Report wave 1 implementation and acceptance tasks`.
- Продуктовые решения и бэклог: Notion.
- Implementation specs, планы, verification и runbooks: GitHub `docs/`.
- Обязательно сначала прочитать `AGENTS.md`; репозиторий `Konstantin-portfolio` не открывать и не использовать.

## 3. Что уже завершено — не переделывать

| Фича | Фактический статус | Коммит |
|---|---|---|
| **BL-50 · Commitment Tracking — автовыделение обязательств из переписки (развитие BL-6)** | Изолированная реализация завершена; contract 15/15 | `ca4b0bd` |
| **BL-55 · Learning Loop — самоулучшение генерации поручений и решений по их исходам** | Изолированная реализация завершена; contract 14/14 | `575ac72` |
| **BL-52 · Email-надзор — почтовый ящик бота для сбора фактуры (CC/пересылка)** | Только спецификация v1.0-draft | `f053e7d` |
| **BL-43 · Канал доставки: MAX** | Только спецификация v1.0-draft по официальному API | `f053e7d` |
| **BL-50 · Commitment Tracking — автовыделение обязательств из переписки (развитие BL-6): реальный пилот** | Сценарий подготовлен, не подтверждён и не выполнен | `f053e7d` |
| Итоговый отчёт волны 1 и задачи владельца | Завершены и опубликованы в GitHub | `c83b063` |

Финальные проверки после последнего кодового/UI-изменения:

- unit: 49/49;
- typecheck и production build: успешно;
- полный regression: успешно;
- изолированные миграции через `0012`: успешно;
- BL-50: 15/15;
- BL-55: 14/14.

Не повторять полный regression без новых изменений кода. Если новая ветка меняет код, сначала отдельно объяснить зачем и затем выполнить полный контроль.

## 4. Ключевые ограничения

1. **BL-50 · Commitment Tracking — автовыделение обязательств из переписки (развитие BL-6)** и **BL-55 · Learning Loop — самоулучшение генерации поручений и решений по их исходам** в production не развёрнуты; миграции `0011`/`0012` там не применялись.
2. Regression evaluator BL-55 — `deterministic-contract`, не реальный AI. Не утверждать автоматическое обучение или доказанное улучшение модели.
3. **BL-48 · Project Impact / Outcome Loop** технически прошёл реальный пилот, но полностью принятым владельцем не отмечен.
4. Не создавать реальные Telegram-сигналы, Email/MAX-подключения или production-сущности без отдельно подтверждённого сценария.
5. Не менять production `.env`, Telegram webhook/gateway, canonical PNG/UI и существующие credentials без отдельного решения.
6. Production cleanup не выполнять. Новые миграции — только аддитивные через Drizzle.
7. Secrets, spreadsheet ID, реальные chat/user IDs и тексты переписки не включать в Git, evidence или Notion.
8. Случайные Chrome-профили, screenshots, DB/scheduler snapshots и regenerated evidence в репозитории не коммитить.
9. Не выдавать mock Telegram/AI/Email/MAX за реальную приёмку.
10. Notion — только через плагин. Браузер допустим для просмотра, но не для записи.

## 5. Первая задача новой ветки — Notion handoff

### 5.1 Сначала только read-only

1. Проверить активное подключение и воркспейс через Notion plugin.
2. Найти родительскую страницу **«AI PMO — продуктовая документация»**:
   https://app.notion.com/p/3632fbb64c0e81ca919ec74125a20a00
3. Найти базу **«Бэклог AI PMO»**:
   https://app.notion.com/p/32d71c1c84004354ae367b2886ced001
4. Прочитать существующие страницы:
   - **SPEC-BL-50 · Commitment Tracking**:
     https://app.notion.com/p/4132fbb64c0e816db5f8da18e9efc20d
   - **SPEC-BL-55 · Learning Loop**:
     https://app.notion.com/p/4132fbb64c0e81bb99ced0c8715d4dea
5. Проверить, нет ли уже созданных другой сессией копий SPEC-BL-52, SPEC-BL-43, сценария BL-50 или итогового отчёта. Не создавать дубликаты.
6. Не выводить тела страниц/строк базы в разговор; показывать только title, page ID и краткое описание изменений.

### 5.2 Показать владельцу перед записью

Предложить создание под **«AI PMO — продуктовая документация»**:

- **SPEC-BL-52 · Email-надзор — почтовый ящик бота для сбора фактуры (CC/пересылка) · v1.0-draft** — источник `docs/specs/SPEC-BL-52-email-supervision.md`.
- **SPEC-BL-43 · Канал доставки: MAX · v1.0-draft** — источник `docs/specs/SPEC-BL-43-max-delivery-channel.md`.
- **BL-50 · Commitment Tracking — сценарий отдельного реального пилота · 10.11.2026** — источник `docs/reports/2026-11-10-bl50-real-pilot-scenario.md`.
- **AI PMO · Волна 1 — BL-50, BL-55 и подготовка новых каналов** — источник `docs/reports/2026-11-10-wave-1-bl50-bl55-report.md`.

Предложить обновление существующих страниц только после отдельного подтверждения:

- SPEC-BL-50: isolated implementation, `ca4b0bd`, 15/15, нет production deployment и реального пилота.
- SPEC-BL-55: isolated implementation, `575ac72`, 14/14, deterministic evaluator, нет production deployment и реальной AI-оценки.
- BL-50/BL-55 в бэклоге: отразить isolated readiness и ожидание реальной приёмки; не отмечать production-принятыми.
- BL-52/BL-43 в бэклоге: связать со спецификациями; не отмечать реализованными.
- **BL-48 · Project Impact / Outcome Loop**: статус не повышать без отдельного решения владельца.

### 5.3 После публикации

1. Повторно прочитать созданные/изменённые страницы и проверить заголовки, родителя, статусы и ссылки.
2. Сохранить page IDs/URLs без чувствительного содержимого в новый GitHub-отчёт `docs/reports/2026-11-10-notion-wave-1-sync.md`.
3. Зафиксировать только этот отчёт отдельным коммитом и отправить в `origin/main`.
4. В финальном ответе перечислить опубликованные страницы и оставшиеся действия владельца.

## 6. Следующие задачи после Notion — только по подтверждению владельца

### Реальный пилот BL-50

Источник: `docs/reports/2026-11-10-bl50-real-pilot-scenario.md`.

Владельцу нужно выбрать один проект, разрешённый read-only чат, РП и одно настоящее новое обязательство. Release, backup, миграция `0011`, одно личное предложение РП и restart выполняются только после подтверждения формулировки из раздела 10 сценария. BL-55 не активировать автоматически вместе с BL-50.

### Проверка BL-55

Только после отдельного release и миграции `0012`. Использовать настоящие поправки РП, проверить малые N/`null`, RP-only approval, блокировку деградации, apply/rollback и audit. Не выдавать deterministic regression за реальную AI-оценку.

### BL-52 · Email-надзор — почтовый ящик бота для сбора фактуры (CC/пересылка)

До реализации адаптера нужны provider, отдельный mailbox, один проект, allowlist, OAuth/webhook model, DPA/retention и разрешённая AI data flow. Реальный mailbox не подключать без подтверждения.

### BL-43 · Канал доставки: MAX

Нужны реальный бот, защищённые credentials, HTTPS/TLS и один consent RP DM. Сначала isolated adapter, затем отдельный реальный пилот. Групповые исходящие не включать.

### BL-48 · Project Impact / Outcome Loop

Финальный статус принимает владелец. Технический результат ранее: P-03 → R-06/P-07, baseline 12, target 12, actual 11, эффект +1 день, `confirmed`, `met`, повтор/restart без дублей. Не повторять пилот и не создавать его записи заново.

## 7. Полезные документы

- `docs/reports/2026-11-10-wave-1-bl50-bl55-report.md` — полный итог и задачи приёмки.
- `docs/reports/2026-11-10-bl50-real-pilot-scenario.md` — отдельный сценарий реального пилота.
- `docs/specs/SPEC-BL-50-commitment-tracking.md` — implementation contract BL-50.
- `docs/specs/SPEC-BL-55-learning-loop.md` — implementation contract BL-55.
- `docs/specs/SPEC-BL-52-email-supervision.md` — Email specification.
- `docs/specs/SPEC-BL-43-max-delivery-channel.md` — MAX specification и официальные источники.
- `docs/reports/2026-11-10-bl48-real-pilot.md` — фактический реальный пилот BL-48.
- `docs/plans/PMO_REMAINING_WORK_2026-11-08.md` — исходный порядок волны и ограничения.

## 8. Состояние рабочего дерева

В репозитории есть незакоммиченные regenerated evidence, screenshots, Chrome-профили и DB/scheduler snapshots от проверок. Они не являются новым кодом и не должны попасть в handoff-коммит. Не удалять их массово: они могут быть полезны для локальной трассировки. Добавлять в Git только явно выбранные документы/код.
