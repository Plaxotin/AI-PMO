#!/usr/bin/env python3
"""
Скрипт настройки доступа к Google Sheets API.
Создаёт service account и credentials файл для доступа к Google Sheets.
"""

import os
import json
import sys

def check_dependencies():
    """Проверяет установленные библиотеки."""
    try:
        import gspread
        import google.auth
        print("✅ Библиотеки gspread и google-auth установлены")
        return True
    except ImportError:
        print("❌ Необходимые библиотеки не установлены")
        print("\nУстановите их командой:")
        print("  pip install gspread google-auth google-auth-oauthlib")
        return False

def setup_credentials():
    """Настраивает credentials для Google Sheets API."""
    creds_dir = os.path.join(os.path.dirname(__file__), '..', '.credentials')
    os.makedirs(creds_dir, exist_ok=True)
    
    creds_path = os.path.join(creds_dir, 'gsheets-service-account.json')
    
    if os.path.exists(creds_path):
        print(f"⚠️  Файл credentials уже существует: {creds_path}")
        overwrite = input("Перезаписать? (y/n): ").lower().strip()
        if overwrite != 'y':
            print("Настройка отменена. Используется существующий файл.")
            return creds_path
    
    print("\n" + "="*60)
    print("НАСТРОЙКА GOOGLE SHEETS API")
    print("="*60)
    print("""
Для работы с Google Sheets необходимо создать Service Account:

1. Откройте https://console.cloud.google.com/
2. Создайте новый проект (или используйте существующий)
3. Перейдите в "APIs & Services" → "Enabled APIs & services"
4. Нажмите "+ ENABLE APIS AND SERVICES"
5. Найдите и включите "Google Sheets API"
6. Перейдите в "APIs & Services" → "Credentials"
7. Нажмите "+ CREATE CREDENTIALS" → "Service account"
8. Заполните имя сервисного аккаунта, нажмите "CREATE AND CONTINUE"
9. Выберите роль "Editor", нажмите "CONTINUE"
10. Нажмите "DONE"
11. В списке сервисных аккаунтов нажмите на созданный аккаунт
12. Перейди во вкладку "KEYS"
13. Нажмите "ADD KEY" → "Create new key" → "JSON"
14. Файл JSON скачается автоматически

Скопируйте содержимое скачанного JSON-файла и вставьте ниже.
""")
    
    print("Вставьте содержимое JSON-файла (нажмите Enter дважды для завершения):")
    lines = []
    while True:
        line = input()
        if not line and lines:
            break
        lines.append(line)
    
    try:
        creds_data = json.loads('\n'.join(lines))
        
        with open(creds_path, 'w', encoding='utf-8') as f:
            json.dump(creds_data, f, ensure_ascii=False, indent=2)
        
        print(f"\n✅ Credentials сохранены в: {creds_path}")
        print(f"   Service Account Email: {creds_data.get('client_email', 'N/A')}")
        
        return creds_path
        
    except json.JSONDecodeError as e:
        print(f"\n❌ Ошибка: неверный формат JSON ({e})")
        return None

def test_connection(creds_path):
    """Проверяет подключение к Google Sheets."""
    try:
        import gspread
        from google.oauth2.service_account import Credentials
        
        scopes = ['https://www.googleapis.com/auth/spreadsheets']
        creds = Credentials.from_service_account_file(creds_path, scopes=scopes)
        client = gspread.authorize(creds)
        
        # Попытка получить список таблиц
        print("\n🔄 Проверка подключения...")
        client.list_spreadsheet_files()
        print("✅ Подключение к Google Sheets API успешно!")
        return True
        
    except Exception as e:
        print(f"\n❌ Ошибка подключения: {e}")
        return False

def main():
    print("🔧 Настройка Google Sheets API для реестра поручений\n")
    
    if not check_dependencies():
        sys.exit(1)
    
    creds_path = setup_credentials()
    if not creds_path:
        sys.exit(1)
    
    if test_connection(creds_path):
        print("\n" + "="*60)
        print("НАСТРОЙКА ЗАВЕРШЕНА")
        print("="*60)
        print(f"""
Credentials файл: {creds_path}

Дальнейшие шаги:
1. Создайте Google Таблицу вручную или через скрипт task_manager.py --init
2. Дайте доступ сервисному аккаунту (email из credentials) к таблице
3. Скопируйте ID таблицы из URL и укажите в config.json
""")
    else:
        print("\n⚠️  Проверьте credentials и попробуйте снова.")
        sys.exit(1)

if __name__ == '__main__':
    main()
