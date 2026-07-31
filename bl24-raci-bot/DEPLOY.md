# Развёртывание BL-24 «Генератор RACI» на облачном сервере

Бот работает в режиме **long polling** — ему не нужен домен, HTTPS и открытые порты.
Достаточно любого VPS с выходом в интернет (Telegram API + Moonshot API).

## 0. Что понадобится

- VPS: 1 vCPU / 1 ГБ RAM достаточно. Рекомендуемые российские облака (для 152-ФЗ):
  **Yandex Cloud, Selectel, Timeweb Cloud, VK Cloud** — Ubuntu 22.04 LTS.
- Токен бота: [@BotFather](https://t.me/BotFather) → `/newbot`.
- Ключ Kimi: [platform.moonshot.cn](https://platform.moonshot.cn) → API Keys.

> ⚠️ **152-ФЗ:** описания проектов уходят в Moonshot API (внешний LLM-сервис).
> Это допустимо, пока пользователи не отправляют ПДн/коммерческую тайну —
> бот предупреждает об этом в /start. Для enterprise-клиентов заложите в roadmap
> вариант с LLM в контуре заказчика.

## 1. Подготовка сервера

```bash
ssh root@<IP_сервера>
apt update && apt upgrade -y
apt install -y python3 python3-venv python3-pip git

# Отдельный пользователь без root
useradd -r -m -s /bin/bash aipmo
```

## 2. Установка кода

```bash
mkdir -p /opt/ai-pmo-raci-bot
chown aipmo:aipmo /opt/ai-pmo-raci-bot

# Вариант А: из git
sudo -u aipmo git clone <URL_репозитория> /opt/ai-pmo-raci-bot
# (код бота в подпапке bl24-raci-bot — скопируйте её содержимое в корень)

# Вариант Б: scp с локальной машины (с Windows, PowerShell):
# scp -r "bl24-raci-bot/*" aipmo@<IP>:/opt/ai-pmo-raci-bot/
```

В итоге в `/opt/ai-pmo-raci-bot/` должны лежать: `bot.py`, `raci_engine.py`,
`kimi_client.py`, `xlsx_builder.py`, `requirements.txt`.

## 3. Окружение и зависимости

```bash
cd /opt/ai-pmo-raci-bot
sudo -u aipmo python3 -m venv .venv
sudo -u aipmo .venv/bin/pip install -r requirements.txt

# Секреты — только в .env, права 600
sudo -u aipmo cp .env.example .env
nano .env            # вписать BOT_TOKEN и KIMI_API_KEY
chmod 600 .env
```

## 4. Проверка перед запуском

```bash
# Офлайн-демо (не требует ключей) — должен создать demo_output/raci_demo.xlsx
sudo -u aipmo .venv/bin/python demo.py

# Ручной запуск бота на 1 минуту — написать боту /start в Telegram
sudo -u aipmo .venv/bin/python bot.py
# Ctrl+C после проверки
```

## 5. Автозапуск через systemd

```bash
sudo cp deploy/ai-pmo-raci-bot.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now ai-pmo-raci-bot
sudo systemctl status ai-pmo-raci-bot
```

Готовый unit-файл лежит в `deploy/ai-pmo-raci-bot.service`
(перезапуск при падении, запуск от пользователя `aipmo`).

## 6. Эксплуатация

```bash
journalctl -u ai-pmo-raci-bot -f        # логи в реальном времени
sudo systemctl restart ai-pmo-raci-bot  # перезапуск (после обновления кода)
```

Обновление кода:

```bash
cd /opt/ai-pmo-raci-bot && sudo -u aipmo git pull
sudo systemctl restart ai-pmo-raci-bot
```

## 7. Брандмауэр

Исходящие соединения только — боту не нужны входящие порты.
Достаточно SSH (22) для администрирования:

```bash
ufw allow OpenSSH
ufw enable
```

## Альтернатива: Docker

Если привычнее контейнеры — минимальный `Dockerfile`:

```dockerfile
FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY bot.py raci_engine.py kimi_client.py xlsx_builder.py ./
CMD ["python", "bot.py"]
```

```bash
docker build -t raci-bot .
docker run -d --name raci-bot --restart always --env-file .env raci-bot
```

## Чек-лист готовности

- [ ] `demo.py` отрабатывает, Excel создаётся
- [ ] `/start` в Telegram отвечает приветствием с предупреждением 152-ФЗ
- [ ] Описание проекта → кнопки → режим → получен `.xlsx`
- [ ] `systemctl status` — active (running), автозапуск включён
- [ ] `.env` с правами 600, секреты не в git
