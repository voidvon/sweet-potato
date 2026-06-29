from __future__ import annotations

from .add_friend_entry import click_add_friend_entry
from .add_friend_window import (
    close_current_add_friend_windows,
    focus_add_friend_search_box,
    handle_current_add_friend_result,
    search_add_friend_account,
)
from .friend_result import (
    close_add_friend_windows,
    complete_add_request_flow,
    focus_and_send_chat_message,
    handle_add_friend_search_result,
)
from .panel import ensure_chat_panel, identify_current_panel, switch_panel
from .quick_action import open_quick_action_menu, wait_for_quick_action_menu

__all__ = [
    "click_add_friend_entry",
    "close_add_friend_windows",
    "close_current_add_friend_windows",
    "complete_add_request_flow",
    "ensure_chat_panel",
    "focus_add_friend_search_box",
    "focus_and_send_chat_message",
    "handle_current_add_friend_result",
    "handle_add_friend_search_result",
    "identify_current_panel",
    "open_quick_action_menu",
    "search_add_friend_account",
    "switch_panel",
    "wait_for_quick_action_menu",
]
