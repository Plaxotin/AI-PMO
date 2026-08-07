import os
import sys

# Устанавливаем UTF-8 для stdout/stderr
os.environ['PYTHONIOENCODING'] = 'utf-8'

# Добавляем путь к скриптам
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, SCRIPT_DIR)

from bot_handler import main_loop

if __name__ == '__main__':
    main_loop()
