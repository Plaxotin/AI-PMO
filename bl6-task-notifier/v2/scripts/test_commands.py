#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Юнит-тесты парсера команд commands.py (BL-6, v2.1).

Модель v2.1: групповой чат не парсится, все команды — личка.
Роли: user (кнопки + реестр/помощь/закрыть), admin (+реестрные команды),
superadmin (+конфигурация).

Запуск:  python test_commands.py
"""

import sys
import os
import unittest
from datetime import date

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import commands  # noqa: E402

# Фиксированная «сегодняшняя» дата для детерминированных тестов:
# 12.08.2026 — среда (weekday()==2)
TODAY = date(2026, 8, 12)

ADMIN = dict(role="admin")
SUPERADMIN = dict(role="superadmin")
USER = dict(role="user")


def parse(text, role="user"):
    return commands.parse(text, role=role, today=TODAY)


# ======== УМНЫЕ ДАТЫ ========

class TestDates(unittest.TestCase):
    def test_tomorrow(self):
        self.assertEqual(commands.normalize_date("завтра", TODAY), "13.08.2026")

    def test_day_after_tomorrow(self):
        self.assertEqual(commands.normalize_date("послезавтра", TODAY), "14.08.2026")

    def test_today(self):
        self.assertEqual(commands.normalize_date("сегодня", TODAY), "12.08.2026")

    def test_weekday_friday(self):
        # Среда -> ближайшая пятница = 14.08.2026
        self.assertEqual(commands.normalize_date("в пятницу", TODAY), "14.08.2026")

    def test_weekday_same_day(self):
        friday = date(2026, 8, 14)  # пятница
        self.assertEqual(commands.normalize_date("в пятницу", friday), "14.08.2026")

    def test_weekday_monday_next_week(self):
        # Среда -> понедельник уже прошёл, берём следующий = 17.08.2026
        self.assertEqual(commands.normalize_date("в понедельник", TODAY), "17.08.2026")

    def test_weekday_vo_variant(self):
        # Среда -> во вторник = 18.08.2026
        self.assertEqual(commands.normalize_date("во вторник", TODAY), "18.08.2026")

    def test_numeric_full(self):
        self.assertEqual(commands.normalize_date("20.08.2026", TODAY), "20.08.2026")

    def test_numeric_short_year(self):
        self.assertEqual(commands.normalize_date("20.08.26", TODAY), "20.08.2026")

    def test_numeric_no_year_future(self):
        self.assertEqual(commands.normalize_date("20.08", TODAY), "20.08.2026")

    def test_numeric_no_year_past_rolls_to_next_year(self):
        # 01.01 уже прошло относительно 12.08.2026 -> 01.01.2027
        self.assertEqual(commands.normalize_date("01.01", TODAY), "01.01.2027")

    def test_numeric_invalid(self):
        self.assertIsNone(commands.normalize_date("32.13.2026", TODAY))
        self.assertIsNone(commands.normalize_date("29.02.2026", TODAY))

    def test_garbage(self):
        self.assertIsNone(commands.normalize_date("когда-нибудь", TODAY))


# ======== КОМАНДЫ, ДОСТУПНЫЕ ВСЕМ (личка) ========

class TestPublicCommands(unittest.TestCase):
    def test_registry_link_user(self):
        c = parse("реестр", **USER)
        self.assertTrue(c.ok, c.error)
        self.assertEqual(c.name, "registry_link")

    def test_registry_link_case(self):
        c =parse("  РЕЕСТР ", **USER)
        self.assertTrue(c.ok, c.error)

    def test_help_user(self):
        c = parse("помощь", **USER)
        self.assertTrue(c.ok)
        self.assertEqual(c.name, "help")

    def test_start_user(self):
        c = parse("/start", **USER)
        self.assertTrue(c.ok)
        self.assertEqual(c.name, "help")

    def test_close_user(self):
        # «закрыть #N» доступно всем; проверка владельца — в обработчике
        c = parse("закрыть #12", **USER)
        self.assertTrue(c.ok, c.error)
        self.assertEqual(c.name, "close")
        self.assertEqual(c.args["id"], 12)

    def test_close_no_space(self):
        c = parse("закрыть#7", **USER)
        self.assertTrue(c.ok)
        self.assertEqual(c.args["id"], 7)

    def test_close_bad_id(self):
        c = parse("закрыть #abc", **USER)
        self.assertFalse(c.ok)
        self.assertIn("Не понял команду", c.error)


# ======== ПРАВА: ОБЫЧНЫЙ ПОЛЬЗОВАТЕЛЬ ========

class TestUserDenied(unittest.TestCase):
    def test_user_create_denied(self):
        c = parse("создать поручение: Проект=A; Описание=B; "
                  "Ответственный=C; Срок=завтра", **USER)
        self.assertFalse(c.ok)
        self.assertIn("администраторам", c.error)

    def test_user_deadline_denied(self):
        c = parse("срок #1 завтра", **USER)
        self.assertFalse(c.ok)
        self.assertIn("администраторам", c.error)

    def test_user_delete_denied(self):
        c = parse("удалить #1", **USER)
        self.assertFalse(c.ok)
        self.assertIn("администраторам", c.error)

    def test_user_new_registry_denied(self):
        c = parse("новый реестр Реестр 2027", **USER)
        self.assertFalse(c.ok)
        self.assertIn("администраторам", c.error)

    def test_user_list_all_denied(self):
        c = parse("все поручения", **USER)
        self.assertFalse(c.ok)
        self.assertIn("администраторам", c.error)

    def test_user_digest_denied(self):
        c = parse("дайджест", **USER)
        self.assertFalse(c.ok)
        self.assertIn("администраторам", c.error)

    def test_user_superadmin_denied(self):
        c = parse("админы", **USER)
        self.assertFalse(c.ok)
        self.assertIn("суперадминистратору", c.error)


# ======== НОВЫЙ РЕЕСТР ========

class TestNewRegistry(unittest.TestCase):
    def test_admin_ok(self):
        c = parse("новый реестр Реестр поручений 2027", **ADMIN)
        self.assertTrue(c.ok, c.error)
        self.assertEqual(c.name, "new_registry")
        self.assertEqual(c.args["title"], "Реестр поручений 2027")

    def test_superadmin_ok(self):
        c = parse("Новый   реестр   Q3", **SUPERADMIN)
        self.assertTrue(c.ok, c.error)
        self.assertEqual(c.args["title"], "Q3")

    def test_user_denied(self):
        c = parse("новый реестр Хак", **USER)
        self.assertFalse(c.ok)

    def test_empty_title_is_unknown(self):
        c = parse("новый реестр", **ADMIN)
        self.assertFalse(c.ok)
        self.assertIn("Не понял команду", c.error)


# ======== СПИСКИ (админы) ========

class TestListCommands(unittest.TestCase):
    def test_list_my(self):
        c = parse("мои поручения", **ADMIN)
        self.assertTrue(c.ok)
        self.assertEqual(c.name, "list_my")

    def test_list_all(self):
        c = parse("все поручения", **ADMIN)
        self.assertTrue(c.ok)
        self.assertEqual(c.name, "list_all")

    def test_list_project(self):
        c = parse("поручения БЛ-6 Автоматизация", **ADMIN)
        self.assertTrue(c.ok)
        self.assertEqual(c.name, "list_project")
        self.assertEqual(c.args["project"], "БЛ-6 Автоматизация")

    def test_list_status(self):
        c = parse("поручения статус В работе", **ADMIN)
        self.assertTrue(c.ok)
        self.assertEqual(c.name, "list_status")
        self.assertEqual(c.args["status"], "В работе")


# ======== СОЗДАНИЕ ПОРУЧЕНИЯ (админы) ========

class TestCreate(unittest.TestCase):
    GOOD = ("создать поручение: Проект=BL-6; Описание=Починить дайджест; "
            "Ответственный=Иванова Т.; Срок=20.08.2026")

    def test_create_ok(self):
        c = parse(self.GOOD, **ADMIN)
        self.assertTrue(c.ok, c.error)
        self.assertEqual(c.name, "create")
        self.assertEqual(c.args["project"], "BL-6")
        self.assertEqual(c.args["description"], "Починить дайджест")
        self.assertEqual(c.args["assignee"], "Иванова Т.")
        self.assertEqual(c.args["deadline"], "20.08.2026")

    def test_create_smart_date(self):
        c = parse("создать поручение: Проект=BL-6; Описание=Тест; "
                  "Ответственный=Иванов; Срок=в пятницу", **ADMIN)
        self.assertTrue(c.ok, c.error)
        self.assertEqual(c.args["deadline"], "14.08.2026")

    def test_create_case_insensitive_keys(self):
        c = parse("Создать поручение: ПРОЕКТ=BL-6; описание=Тест; "
                  "Ответственный=Иванов; СРОК=завтра", **ADMIN)
        self.assertTrue(c.ok, c.error)
        self.assertEqual(c.args["project"], "BL-6")
        self.assertEqual(c.args["deadline"], "13.08.2026")

    def test_create_missing_field(self):
        c = parse("создать поручение: Проект=BL-6; Описание=Тест; Срок=завтра", **ADMIN)
        self.assertFalse(c.ok)
        self.assertIn("Ответственный", c.error)

    def test_create_empty_body(self):
        c = parse("создать поручение:", **ADMIN)
        self.assertFalse(c.ok)
        self.assertIn("Укажите поля", c.error)

    def test_create_unknown_field(self):
        c = parse("создать поручение: Проект=BL-6; Описание=Тест; "
                  "Ответственный=Иванов; Срок=завтра; Приоритет=высокий", **ADMIN)
        self.assertFalse(c.ok)
        self.assertIn("Неизвестное поле", c.error)

    def test_create_bad_date(self):
        c = parse("создать поручение: Проект=BL-6; Описание=Тест; "
                  "Ответственный=Иванов; Срок=когда-нибудь", **ADMIN)
        self.assertFalse(c.ok)
        self.assertIn("Не понял дату", c.error)

    def test_create_no_separator(self):
        c = parse("создать поручение: Проект BL-6; Описание=Тест; "
                  "Ответственный=Иванов; Срок=завтра", **ADMIN)
        self.assertFalse(c.ok)
        self.assertIn("Имя=Значение", c.error)


# ======== АДМИНСКИЕ КОМАНДЫ ========

class TestAdminCommands(unittest.TestCase):
    def test_deadline(self):
        c = parse("срок #12 20.08.2026", **ADMIN)
        self.assertTrue(c.ok, c.error)
        self.assertEqual(c.name, "deadline")
        self.assertEqual(c.args["id"], 12)
        self.assertEqual(c.args["date"], "20.08.2026")

    def test_deadline_smart(self):
        c = parse("срок #12 завтра", **ADMIN)
        self.assertTrue(c.ok, c.error)
        self.assertEqual(c.args["date"], "13.08.2026")

    def test_deadline_bad_date(self):
        c = parse("срок #12 вчера", **ADMIN)
        self.assertFalse(c.ok)
        self.assertIn("Не понял дату", c.error)

    def test_status(self):
        c = parse("статус #12 В работе", **ADMIN)
        self.assertTrue(c.ok, c.error)
        self.assertEqual(c.name, "status")
        self.assertEqual(c.args["status"], "В работе")

    def test_assignee(self):
        c = parse("ответственный #12 Иванова Т.", **ADMIN)
        self.assertTrue(c.ok, c.error)
        self.assertEqual(c.args["assignee"], "Иванова Т.")

    def test_description(self):
        c = parse("описание #12 Новый текст поручения", **ADMIN)
        self.assertTrue(c.ok, c.error)
        self.assertEqual(c.args["description"], "Новый текст поручения")

    def test_comment(self):
        c = parse("комментарий #12 ждём ответ заказчика", **ADMIN)
        self.assertTrue(c.ok, c.error)
        self.assertEqual(c.args["comment"], "ждём ответ заказчика")

    def test_delete(self):
        c = parse("удалить #12", **ADMIN)
        self.assertTrue(c.ok, c.error)
        self.assertEqual(c.name, "delete")
        self.assertEqual(c.args["id"], 12)

    def test_digest(self):
        c = parse("дайджест", **ADMIN)
        self.assertTrue(c.ok, c.error)
        self.assertEqual(c.name, "digest")


# ======== СУПЕРАДМИН ========

class TestSuperadminCommands(unittest.TestCase):
    def test_add_admin(self):
        c = parse("добавить админа @ivanov", **SUPERADMIN)
        self.assertTrue(c.ok, c.error)
        self.assertEqual(c.name, "add_admin")
        self.assertEqual(c.args["username"], "ivanov")

    def test_remove_admin(self):
        c = parse("убрать админа @ivanov", **SUPERADMIN)
        self.assertTrue(c.ok, c.error)
        self.assertEqual(c.name, "remove_admin")

    def test_list_admins(self):
        c = parse("админы", **SUPERADMIN)
        self.assertTrue(c.ok, c.error)
        self.assertEqual(c.name, "list_admins")

    def test_set_limits(self):
        c = parse("лимиты 15 200", **SUPERADMIN)
        self.assertTrue(c.ok, c.error)
        self.assertEqual(c.args["per_min"], 15)
        self.assertEqual(c.args["per_day"], 200)

    def test_versions(self):
        c = parse("версии", **SUPERADMIN)
        self.assertTrue(c.ok, c.error)
        self.assertEqual(c.name, "versions")

    def test_rollback(self):
        c = parse("откатить конфиг v2.0", **SUPERADMIN)
        self.assertTrue(c.ok, c.error)
        self.assertEqual(c.args["version"], "v2.0")

    def test_superadmin_command_denied_for_admin(self):
        c = parse("админы", **ADMIN)
        self.assertFalse(c.ok)
        self.assertIn("суперадминистратору", c.error)

    def test_rollback_denied_for_admin(self):
        c = parse("откатить конфиг v1.0", **ADMIN)
        self.assertFalse(c.ok)
        self.assertIn("суперадминистратору", c.error)


# ======== НЕРАСПОЗНАННОЕ ========

class TestUnknown(unittest.TestCase):
    def test_garbage(self):
        c = parse("бла бла бла", **USER)
        self.assertFalse(c.ok)
        self.assertIn("Не понял команду", c.error)

    def test_typo_close(self):
        c = parse("закрой #12", **USER)
        self.assertFalse(c.ok)
        self.assertIn("Не понял команду", c.error)

    def test_missing_value(self):
        c = parse("срок #12", **ADMIN)
        self.assertFalse(c.ok)

    def test_empty(self):
        c = parse("   ", **USER)
        self.assertFalse(c.ok)

    def test_help_text_has_registry_for_user(self):
        text = commands.help_text("user")
        self.assertIn("реестр", text)
        self.assertNotIn("новый реестр", text)

    def test_help_text_admin_has_new_registry(self):
        text = commands.help_text("admin")
        self.assertIn("новый реестр", text)

    def test_help_text_superadmin_has_config(self):
        text = commands.help_text("superadmin")
        self.assertIn("откатить конфиг", text)


# ======== LLM-МАРШРУТИЗАЦИЯ (v2.2) ========

class TestLlmRouting(unittest.TestCase):
    def test_admin_routes_to_llm(self):
        self.assertEqual(commands.route_unrecognized("admin"), "llm")

    def test_superadmin_routes_to_llm(self):
        self.assertEqual(commands.route_unrecognized("superadmin"), "llm")

    def test_user_no_llm(self):
        # Обычный пользователь: сразу «Не понял»/кнопки, без LLM
        self.assertEqual(commands.route_unrecognized("user"), "fallback")

    def test_unrecognized_admin_text_is_not_ok(self):
        # Свободная форма не парсится → уходит в llm-путь по route_unrecognized
        c = parse("перенеси пожалуйста дедлайн двенадцатой задачи на пятницу", **ADMIN)
        self.assertFalse(c.ok)
        self.assertEqual(commands.route_unrecognized("admin"), "llm")

    def test_unrecognized_user_text_stays_fallback(self):
        c = parse("перенеси пожалуйста дедлайн задачи", **USER)
        self.assertFalse(c.ok)
        self.assertEqual(commands.route_unrecognized("user"), "fallback")


class TestLlmExtractJson(unittest.TestCase):
    """Чистые тесты разбора ответа модели (без сети)."""

    def test_plain_json(self):
        import llm
        d = llm.extract_json('{"command_text": "закрыть #12"}')
        self.assertEqual(d, {"command_text": "закрыть #12"})

    def test_markdown_wrapped(self):
        import llm
        d = llm.extract_json('```json\n{"command_text": "все поручения"}\n```')
        self.assertEqual(d["command_text"], "все поручения")

    def test_null_command(self):
        import llm
        d = llm.extract_json('{"command_text": null}')
        self.assertIsNone(d["command_text"])

    def test_garbage(self):
        import llm
        self.assertIsNone(llm.extract_json("просто текст без json"))
        self.assertIsNone(llm.extract_json(""))
        self.assertIsNone(llm.extract_json(None))

    def test_no_config_returns_none(self):
        # Локально kimi.json нет → interpret_free_text обязан вернуть None без сети
        import llm
        self.assertIsNone(llm.interpret_free_text("закрой задачу", "12.08.2026",
                                                  log_fn=lambda m: None))


if __name__ == "__main__":
    unittest.main(verbosity=2)
