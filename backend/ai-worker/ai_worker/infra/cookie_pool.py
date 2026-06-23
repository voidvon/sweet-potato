import random

from ai_worker.config import settings
from ai_worker.domain.errors import VideoUnavailableError
from ai_worker.infra import logger


class CookiePool:
    def __init__(self, cookie_text: str):
        self.all_cookies = [item.strip() for item in cookie_text.split(",") if item.strip()]
        self.valid_cookies = self.all_cookies.copy()

    def invalid_format_count(self) -> int:
        return len([cookie for cookie in self.all_cookies if not self._looks_like_browser_cookie(cookie)])

    def has_valid_format(self) -> bool:
        return any(self._looks_like_browser_cookie(cookie) for cookie in self.all_cookies)

    def ensure_ready(self):
        if not self.all_cookies:
            raise VideoUnavailableError("无法解析：无可用抖音账号 Cookie，请补充账号")
        if not self.has_valid_format():
            raise VideoUnavailableError("无法解析：抖音 Cookie 格式不正确，请从浏览器复制完整 Cookie Header（例如包含 sessionid=...; ttwid=... 的 key=value 列表）")

    def reset(self):
        self.valid_cookies = self.all_cookies.copy()

    def get_random_cookie(self) -> str:
        if not self.valid_cookies:
            raise VideoUnavailableError("无可用抖音账号 Cookie，请补充账号")
        return random.choice(self.valid_cookies)

    def mark_invalid(self, cookie: str, reason: str = ""):
        if cookie in self.valid_cookies:
            self.valid_cookies.remove(cookie)
        logger.warning("douyin cookie marked invalid", {
            "remaining": len(self.valid_cookies),
            "reason": reason,
        })

    def stats(self) -> dict:
        return {
            "total": len(self.all_cookies),
            "valid": len(self.valid_cookies),
            "invalidFormat": self.invalid_format_count(),
        }

    @staticmethod
    def _looks_like_browser_cookie(cookie: str) -> bool:
        names = set()
        for part in cookie.split(";"):
            item = part.strip()
            if "=" in item:
                names.add(item.split("=", 1)[0].strip())
        return bool(names) and any(name in names for name in ("sessionid", "sessionid_ss", "sid_tt", "ttwid"))


cookie_pool = CookiePool(settings.douyin_cookies)
