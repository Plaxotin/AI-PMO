# BL2-0 — настройка секретов (Google OAuth + SaluteSpeech)

**Репозиторий:** `Plaxotin/AI-PMO`  
**Спека:** `docs/specs/SPEC-BL-6-assignments-admin-v2.2.md` §14, фаза BL2-0  
**Решение:** Google Sheets — **OAuth 2.0** (см. `docs/specs/BL6_PRODUCT_DECISIONS.md` §7). Service Account **не используется**.

Пошаговая настройка п.1–3 чеклиста подготовки. Секреты **не коммитить** — только Cursor Cloud Secrets, Vercel и `app/.env.local`.

---

## Куда класть переменные

| Переменная | Cursor Cloud → Secrets | `app/.env.local` | Vercel (`app/`) |
|------------|------------------------|------------------|-----------------|
| `GOOGLE_CLIENT_ID` | да | да | да |
| `GOOGLE_CLIENT_SECRET` | да | да | да |
| `GOOGLE_REDIRECT_URI` | да | да | да |
| `SALUTESPEECH_CLIENT_ID` | да | да | да |
| `SALUTESPEECH_SECRET` | да | да | да |
| `LLM_PROVIDER` | да | да | да |
| `LLM_API_BASE_URL` | да | да | да |
| `LLM_MODEL_ID` | да | да | да |
| `LLM_API_KEY` | да | да | да |

Access/refresh-токены Google после входа пользователя хранятся **в сессии приложения** (cookie/БД), не в Cursor/Vercel env.

---

## 1. Google OAuth 2.0 Client

### 1.1 Проект и API

1. [Google Cloud Console](https://console.cloud.google.com/) → проект.
2. **APIs & Services → Library** → включить:
   - **Google Sheets API**
   - **Google Drive API** (создание таблицы по шаблону в `sheets/init`)

### 1.2 OAuth consent screen

1. **APIs & Services → OAuth consent screen**.
2. Тип: **External** (тест) или **Internal** (Google Workspace).
3. Добавьте scopes (ориентир BL2-0):
   - `https://www.googleapis.com/auth/spreadsheets`
   - `https://www.googleapis.com/auth/drive.file`
4. В **Test users** добавьте Google-аккаунты пилота (пока приложение в Testing).

### 1.3 OAuth Client ID

1. **Credentials → Create credentials → OAuth client ID**.
2. Тип: **Web application**.
3. **Authorized redirect URIs** (примеры):

| Среда | URI |
|-------|-----|
| Локально | `http://localhost:3000/api/auth/google/callback` |
| Vercel preview/prod | `https://<your-app>.vercel.app/api/auth/google/callback` |

Имя пути callback уточняется при реализации BL2-0; **до кода** зафиксируйте один URI в `GOOGLE_REDIRECT_URI` и добавьте его в GCP.

4. Скопируйте **Client ID** и **Client secret** → env.

### 1.4 Env

```env
GOOGLE_CLIENT_ID=....apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-...
GOOGLE_REDIRECT_URI=http://localhost:3000/api/auth/google/callback
```

### 1.2.2 «Ineligible accounts not added» при добавлении Test user

Сообщение: *The following email addresses are either not associated with a Google Account or the account is not eligible…*

| Причина | Что сделать |
|---------|-------------|
| **Аккаунт уже в списке** | Google **автоматически** добавляет владельца проекта Cloud. Откройте **Audience → Test users** и прокрутите список — если `plaxotin9@gmail.com` уже есть, **ничего добавлять не нужно**, сразу пробуйте вход на `/assignments`. |
| **Опечатка в email** | Проверьте точное написание (точка vs цифра: `plaxotin9` vs `plaxotin`). Адрес должен совпадать с **основным** email Google-аккаунта, не алиасом «Отправить как». |
| **Нет Google-аккаунта** | Откройте https://accounts.google.com/ под этим адресом. Если вход невозможен — создайте Google-аккаунт или используйте другой email. |
| **Тип приложения Internal** | На **OAuth consent screen** тип должен быть **External** (для личного `@gmail.com`). **Internal** — только пользователи вашего Google Workspace. |
| **Проект в организации Workspace** | Организация может запрещать consumer Gmail как test users. **Обход:** новый проект GCP → Location: **No organization** (личный аккаунт) → новый OAuth Client → env в Vercel. |
| **Другой email владеет проектом** | В Cloud Console посмотрите, под кем вы вошли (аватар справа). Test user должен быть тот, **кем входите в BL-6**, либо его нужно добавить отдельно. |

### 1.2.1 Ошибка 403 `access_denied` («приложение не прошло проверку Google»)

Типичная причина на пилоте: **OAuth consent screen → Publishing status = Testing**, а ваш Google-аккаунт **не добавлен** в **Test users**.

**Что сделать (5 минут):**

1. Откройте [Google Cloud Console](https://console.cloud.google.com/) → тот же проект, где создан Client ID `…apps.googleusercontent.com`.
2. **APIs & Services → OAuth consent screen**.
3. Убедитесь, что статус **Testing** (для пилота это нормально).
4. Прокрутите до **Test users** → **+ Add users**.
5. Добавьте **точный email**, под которым входите в Google (ваш `@gmail.com` или корпоративный).
6. **Save** → подождите 1–2 минуты → снова [https://ai-pmo-tawny.vercel.app/assignments](https://ai-pmo-tawny.vercel.app/assignments) → «Войти через Google».

**Проверьте также:**

| Проверка | Где |
|----------|-----|
| `redirect_uri` в ошибке = `GOOGLE_REDIRECT_URI` в Vercel | Credentials → OAuth Client → Authorized redirect URIs |
| Включены Sheets API и Drive API | APIs & Services → Library |
| Scopes: `spreadsheets`, `drive.file` | OAuth consent screen → Scopes |

**Если у вас Google Workspace:** можно выбрать тип приложения **Internal** — тогда все пользователи домена входят без Test users (без публикации в Google).

**Для доступа любых внешних пользователей без списка Test users:** нужна **публикация** приложения (In production) и при необходимости **верификация Google** для чувствительных scopes — это отдельный процесс, не блокер пилота.

Параметры из «Подробная информация» (норма для BL2-0):

- `client_id=…apps.googleusercontent.com`
- `redirect_uri=https://ai-pmo-tawny.vercel.app/api/auth/google/callback`
- `scope=…/auth/spreadsheets …/auth/drive.file`

### 1.5 Миграция с Service Account

Если ранее настраивали `GOOGLE_SERVICE_ACCOUNT_EMAIL` / `GOOGLE_PRIVATE_KEY` — **удалите** их из Cursor/Vercel и замените на три переменные OAuth выше.

---

## 2. SaluteSpeech (Сбер)

Документация: [Аутентификация SaluteSpeech](https://developers.sber.ru/docs/ru/salutespeech/api/authentication).

1. [developers.sber.ru](https://developers.sber.ru/) → проект **SaluteSpeech API**.
2. **Client ID** и **Client Secret** → env.

```env
SALUTESPEECH_CLIENT_ID=...
SALUTESPEECH_SECRET=...
# SALUTESPEECH_SCOPE=SALUTE_SPEECH_PERS
```

| Тип аккаунта | `SALUTESPEECH_SCOPE` |
|--------------|----------------------|
| Физлицо | `SALUTE_SPEECH_PERS` (по умолчанию) |
| Юрлицо | `SALUTE_SPEECH_CORP` |

---

## 3. LLM (Moonshot Kimi — зафиксировано для BL2-0)

Решение Product: **`moonshot-v1-8k`** на [api.moonshot.ai](https://api.moonshot.ai/v1). Подробности — `docs/specs/BL6_PRODUCT_DECISIONS.md` §8.

| Переменная | Значение |
|------------|----------|
| `LLM_PROVIDER` | `kimi` |
| `LLM_API_BASE_URL` | `https://api.moonshot.ai/v1` |
| `LLM_MODEL_ID` | `moonshot-v1-8k` |
| `LLM_API_KEY` | [platform.moonshot.ai → API Keys](https://platform.moonshot.ai/console/api-keys) |

Те же четыре имени — в **Cursor Secrets** и **Vercel** (`app/`).

Для длинных транскриптов совещаний (📎) при необходимости: `moonshot-v1-32k` или `moonshot-v1-128k` (проверка: `curl.exe "https://api.moonshot.ai/v1/models" -H "Authorization: Bearer …"`).

---

## 4. Проверка

```bash
cd app
cp .env.example .env.local   # заполните значения
npm install
npm run verify:bl2-secrets
```

Ожидается:

- `SaluteSpeech: access token OK`
- `Google OAuth: env OK` (полный OAuth flow проверяется вручную после реализации `/api/auth/google`)

---

## 5. Чеклист перед BL2-0

- [ ] Sheets API + Drive API включены в GCP
- [ ] OAuth consent screen + test users
- [ ] OAuth Web Client создан; redirect URI совпадает с `GOOGLE_REDIRECT_URI`
- [ ] `GOOGLE_CLIENT_*` и `GOOGLE_REDIRECT_URI` в Cursor + Vercel + `.env.local`
- [ ] `SALUTESPEECH_*` в Cursor + Vercel + `.env.local`
- [ ] LLM: `LLM_PROVIDER=kimi`, `LLM_API_BASE_URL`, `LLM_MODEL_ID=moonshot-v1-8k`, `LLM_API_KEY`
- [ ] `npm run verify:bl2-secrets` проходит
- [ ] Старые `GOOGLE_SERVICE_ACCOUNT_*` удалены из секретов

---

## 6. Что проверить после реализации OAuth в коде

1. Вход через Google → consent → refresh-токен в сессии.
2. `POST /api/projects/:id/sheets/init` создаёт таблицу в Drive **пользователя**.
3. «Подключить свой реестр» работает без шаринга на service account.
