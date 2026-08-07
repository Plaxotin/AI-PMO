#!/usr/bin/env python3
"""
Скрипт настройки Telegram-бота для уведомлений о поручениях.
"""

import os
import json
import sys

def setup_telegram():
    """Настраивает Telegram-бота."""
    creds_dir = os.path.join(os.path.dirname(__file__), '..', '.credentials')
    os.makedirs(creds_dir, exist_ok=True)
    
    config_path = os.path.join(creds_dir, 'telegram.json')
    
    print("\n" + "="*60)
    print("НАСТРОЙКА TELEGRAM-БОТА ДЛЯ УВЕДОМЛЕНИЙ")
    print("="*60)
    print("""
Для получения уведомлений о поручениях в Telegram:

1. Откройте Telegram и найдите @BotFather
2. Отправьте команду /newbot
3. Следуйте инструкциям:
   - Придумайте имя бота (например, "Task Notifier")
   - Придумайте username (например, "my_task_bot")
4. BotFather выдаст токен вида:
   123456789:ABCdefGHIjklMNOpqrsTUVwxyz
5. Скопируйте токен и вставьте ниже
""")
    
    token = input("Введите токен бота: ").strip()
    
    if not token or ':' not in token:
        print("❌ Неверный формат токена. Ожидается формат: 123456789:ABCdef...")
        return None
    
    print("""
Теперь нужно узнать ваш chat_id:

1. Найдите созданного бота в Telegram по username
2. Нажмите /start или отправьте любое сообщение
3. Откройте в браузере:
   https://api.telegram.org/bot<ТОКЕН>/getUpdates
   (замените <ТОКЕН> на реальный токен)
4. Найдите значение "chat":{"id":123456789
   Это и есть ваш chat_id
""")
    
    chat_id = input("Введите ваш chat_id: ").strip()
    
    if not chat_id:
        print("❌ Chat ID не может быть пустым")
        return None
    
    config = {
        'bot_token': token,
        'chat_id': chat_id
    }
    
    with open(config_path, 'w', encoding='utf-8') as f:
        json.dump(config, f, ensure_ascii=False, indent=2)
    
    print(f"\n✅ Telegram-конфиг сохранён в: {config_path}")
    
    return config_path

def test_telegram(config_path):
    """Отправляет тестовое сообщение."""
    try:
        import requests
        
        with open(config_path, 'r', encoding='utf-8') as f:
            config = json.load(f)
        
        token = config['bot_token']
        chat_id = config['chat_id']
        
        url = f"https://api.telegram.org/bot{token}/sendMessage"
        payload = {
            'chat_id': chat_id,
            'text': '✅ Бот для уведомлений о поручениях настроен!'
        }
        
        print("\n🔄 Отправка тестового сообщения...")
        response = requests.post(url, json=payload, timeout=30)
        
        if response.status_code == 200:
            print("✅ Тестовое сообщение отправлено! Проверьте Telegram.")
            return True
        else:
            print(f"❌ Ошибка: {response.status_code} - {response.text}")
            return False
            
    except ImportError:
        print("❌ Библиотека requests не установлена")
        print("   Установите: pip install requests")
        return False
    except Exception as e:
        print(f"❌ Ошибка: {e}")
        return False

def main():
    print("🔧 Настройка Telegram-уведомлений для реестра поручений\n")
    
    config_path = setup_telegram()
    if not config_path:
        sys.exit(1)
    
    test = input("\nОтправить тестовое сообщение? (y/n): ").lower().strip()
    if test == 'y':
        if test_telegram(config_path):
            print("\n✅ Telegram-бот готов к работе!")
        else:
            print("\n⚠️  Проверьте токен и chat_id.")
    else:
        print("\nНастройка завершена. Тестирование пропущено.")

if __name__ == '__main__':
    main()
