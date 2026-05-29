# BL2-0 — настройка секретов (Google Sheets + SaluteSpeech)

**Репозиторий:** `Plaxotin/AI-PMO`  
**Спека:** `docs/specs/SPEC-BL-6-assignments-admin-v2.2.md` §14, фаза BL2-0  
**Приложение:** каталог `app/` (Vercel root directory = `app`)

Пошаговая настройка для п.1 (Google) и п.2 (SaluteSpeech) из чеклиста подготовки. Секреты **не коммитить** — только Cursor Cloud Secrets, Vercel и локальный `app/.env.local`.

---

## Куда класть переменные (все три места)

| Переменная | Cursor Cloud → Secrets | `app/.env.local` | Vercel (проект `app/`) |
|------------|------------------------|------------------|-------------------------|
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | да | да | да |
| `GOOGLE_PRIVATE_KEY` | да | да | да |
| `SALUTESPEECH_CLIENT_ID` | да | да | да |
| `SALUTESPEECH_SECRET` | да | да | да |
| `LLM_API_KEY` | да (уже есть) | да | да |

Опционально для проверки доступа к **уже созданной** таблице:

| `GOOGLE_SHEET_ID` | ID из URL `https://docs.google.com/spreadsheets/d/<ID>/edit` |

---

## 1. Google Service Account + Sheets API

### 1.1 Проект и API в Google Cloud Console

1. Откройте [Google Cloud Console](https://console.cloud.google.com/).
2. Создайте проект (или выберите существующий) — запомните **Project ID**.
3. **APIs & Services → Library** → найдите и включите:
   - **Google Sheets API**
   - **Google Drive API** (нужен для создания файлов таблицы по шаблону в BL2-0)

### 1.2 Service Account

1. **IAM & Admin → Service Accounts → Create service account**.
2. Имя, например: `ai-pmo-bl6-sheets`.
3. Роль на уровне проекта для старта достаточно минимальной (доступ к Sheet идёт через **шаринг**, не через Owner). Можно оставить без роли или `Editor` только если создаёте таблицы через API в Drive SA.
4. **Keys → Add key → Create new key → JSON** — скачайте файл **один раз** (повторно ключ не покажут).

Из JSON-файла понадобятся:

| Поле в JSON | Env |
|-------------|-----|
| `client_email` | `GOOGLE_SERVICE_ACCOUNT_EMAIL` |
| `private_key` | `GOOGLE_PRIVATE_KEY` |

### 1.3 Права на Google Sheet

Service Account **не видит** таблицы, пока вы не выдали доступ его email (вид `xxx@xxx.iam.gserviceaccount.com`).

**Вариант A — тестовая таблица вручную**

1. Создайте Google Sheet (или откройте [шаблон PMI](https://docs.google.com/spreadsheets/d/1BVD8pfu6avCFkpf1gR71cZkbHOH0V_bsNHkEa5hm998/edit)).
2. **Share** → добавьте `GOOGLE_SERVICE_ACCOUNT_EMAIL` с ролью **Editor**.
3. Скопируйте ID таблицы из URL в `GOOGLE_SHEET_ID` (для проверки скриптом).

**Вариант B — таблицы создаёт приложение (BL2-0)**

После реализации `sheets/init` таблицы будут создаваться от имени SA; владелец файла — service account. Для пилота с «личным» Drive пользователя позже потребуется **OAuth 2.0** (см. черновик в ветке `cursor/oauth-bl6-spec-fd7f` / PR #28).

### 1.4 Формат `GOOGLE_PRIVATE_KEY` в env

В JSON ключ многострочный. В Vercel / Cursor вставляйте **в одну строку**, заменив переносы на `\n`:

```env
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIIE...\n-----END PRIVATE KEY-----\n"
```

В `app/.env.local` допустимы и реальные переносы в кавычках — главное, чтобы в рантайме ключ парсился с `\n` → перевод строки.

### 1.5 Пример `app/.env.local` (фрагмент)

```env
GOOGLE_SERVICE_ACCOUNT_EMAIL=ai-pmo-bl6@your-project.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
GOOGLE_SHEET_ID=1BVD8pfu6avCFkpf1gR71cZkbHOH0V_bsNHkEa5hm998
```

---

## 2. SaluteSpeech (Сбер)

Документация: [Аутентификация SaluteSpeech](https://developers.sber.ru/docs/ru/salutespeech/api/authentication).

### 2.1 Кабинет

1. [developers.sber.ru](https://developers.sber.ru/) → вход (Сбер ID).
2. **Studio** → создайте проект **SaluteSpeech API**.
3. В настройках проекта / API возьмите **Client ID** и **Client Secret** (иногда показывают готовый Authorization key — нам нужны именно id и secret для env).

### 2.2 Scope

| Тип аккаунта | `SALUTESPEECH_SCOPE` |
|--------------|----------------------|
| Физлицо (личный проект) | `SALUTE_SPEECH_PERS` (по умолчанию) |
| Юрлицо | `SALUTE_SPEECH_CORP` |

### 2.3 Env

```env
SALUTESPEECH_CLIENT_ID=...
SALUTESPEECH_SECRET=...
# SALUTESPEECH_SCOPE=SALUTE_SPEECH_PERS
```

Те же значения — в **Cursor Cloud Secrets** и **Vercel** (без `NEXT_PUBLIC_`).

### 2.4 Проверка токена

После заполнения `.env.local`:

```bash
cd app
npm run verify:bl2-secrets
```

Ожидается: `SaluteSpeech: access token OK` и `Google SA: access token OK` (если заданы Google-переменные).

---

## 3. Чеклист перед BL2-0

- [ ] Sheets API + Drive API включены в GCP
- [ ] Service Account создан, JSON-ключ сохранён в менеджере паролей (не в git)
- [ ] `GOOGLE_SERVICE_ACCOUNT_EMAIL` и `GOOGLE_PRIVATE_KEY` в Cursor + Vercel + `.env.local`
- [ ] Тестовый Sheet расшарен на email SA (или готовы к созданию таблицы через API)
- [ ] `SALUTESPEECH_CLIENT_ID` и `SALUTESPEECH_SECRET` в Cursor + Vercel + `.env.local`
- [ ] `npm run verify:bl2-secrets` проходит
- [ ] `LLM_API_KEY` уже настроен (см. `docs/plans/BL1-0_ENV.md`)

---

## 4. Ограничения Service Account (важно)

| Сценарий v2.2 | Service Account | OAuth 2.0 пользователя |
|---------------|-----------------|-------------------------|
| Общая тестовая таблица, расшаренная на SA | да | да |
| «Подключить свой реестр» (таблица пользователя) | только если пользователь шарит на SA | да, штатно |
| Авто-создание таблицы в **личном** Drive пользователя | нет (файл будет у SA) | да |

Для прод-пилота с личными таблицами планируется переход на OAuth (см. PR #28); текущий runbook закрывает **п.1–2 спеки §14** в варианте SA для старта разработки BL2-0.
