package httpapi

import (
	"net/http"
	"strconv"
	"strings"
)

const (
	languageChinese = "zh-CN"
	languageEnglish = "en-US"
)

type languageResponseWriter interface {
	ResponseLanguage() string
}

type localizedResponseWriter struct {
	http.ResponseWriter
	language string
}

func (w *localizedResponseWriter) ResponseLanguage() string {
	return w.language
}

func resolveRequestLanguage(header string) string {
	type preference struct {
		language string
		quality  float64
	}
	best := preference{language: languageChinese, quality: -1}
	for _, part := range strings.Split(header, ",") {
		segments := strings.Split(part, ";")
		tag := strings.ToLower(strings.TrimSpace(segments[0]))
		quality := 1.0
		for _, parameter := range segments[1:] {
			key, value, found := strings.Cut(strings.TrimSpace(parameter), "=")
			if found && strings.EqualFold(key, "q") {
				if parsed, err := strconv.ParseFloat(value, 64); err == nil {
					quality = parsed
				}
			}
		}
		if quality <= 0 {
			continue
		}
		language := ""
		if tag == "en" || strings.HasPrefix(tag, "en-") {
			language = languageEnglish
		}
		if tag == "zh" || strings.HasPrefix(tag, "zh-") {
			language = languageChinese
		}
		if language != "" && quality > best.quality {
			best = preference{language: language, quality: quality}
		}
	}
	return best.language
}

func responseLanguage(w http.ResponseWriter) string {
	if localized, ok := w.(languageResponseWriter); ok {
		return localized.ResponseLanguage()
	}
	return languageChinese
}

func setLocalizedResponseHeaders(w http.ResponseWriter) string {
	language := responseLanguage(w)
	w.Header().Set("Content-Language", language)
	w.Header().Add("Vary", "Accept-Language")
	return language
}

func errorCodeForStatus(status int) string {
	switch status {
	case http.StatusBadRequest:
		return "bad_request"
	case http.StatusUnauthorized:
		return "unauthorized"
	case http.StatusForbidden:
		return "forbidden"
	case http.StatusNotFound:
		return "not_found"
	case http.StatusMethodNotAllowed:
		return "method_not_allowed"
	case http.StatusConflict:
		return "conflict"
	case http.StatusRequestEntityTooLarge:
		return "payload_too_large"
	case http.StatusUnsupportedMediaType:
		return "unsupported_media_type"
	case http.StatusTooManyRequests:
		return "rate_limited"
	default:
		if status >= http.StatusInternalServerError {
			return "internal_error"
		}
		return "request_failed"
	}
}

var englishErrorMessages = map[string]string{
	"请求体格式错误":            "The request body is invalid.",
	"账号至少 3 位，密码至少 6 位":  "The username must be at least 3 characters and the password at least 6 characters.",
	"账号或密码不正确":           "The username or password is incorrect.",
	"账号已被拉黑，请联系管理员":      "This account has been blocked. Contact an administrator.",
	"登录失败":               "Sign-in failed.",
	"登录状态已失效，请重新登录":      "Your session has expired. Please sign in again.",
	"创建账号失败":             "The account could not be created.",
	"请求来源不受信任":           "The request origin is not trusted.",
	"当前 IP 暂时无法访问":       "This IP address is temporarily blocked.",
	"请求过于频繁，请稍后再试":       "Too many requests. Please try again later.",
	"接口不存在":              "The requested endpoint does not exist.",
	"请求方法不支持":            "The request method is not supported.",
	"无权执行此操作":            "You do not have permission to perform this action.",
	"权限不足":               "You do not have sufficient permission.",
	"用户不存在":              "The user does not exist.",
	"角色不存在":              "The role does not exist.",
	"素材不存在":              "The asset does not exist.",
	"附件素材不存在":            "The attachment does not exist.",
	"对话不存在":              "The conversation does not exist.",
	"无权访问该对话":            "You do not have permission to access this conversation.",
	"AI 正在回复中，请等待当前回复完成": "AI is responding. Wait for the current response to finish.",
	"表格不存在":              "The sheet does not exist.",
	"表格行不存在":             "The sheet row does not exist.",
	"批量任务不存在":            "The batch job does not exist.",
	"任务不存在":              "The task does not exist.",
	"文件不存在":              "The file does not exist.",
	"文件过大":               "The file is too large.",
	"上传失败":               "The upload failed.",
	"保存失败":               "The changes could not be saved.",
	"删除失败":               "The item could not be deleted.",
	"服务暂时不可用":            "The service is temporarily unavailable.",
}

func localizedErrorMessage(language string, status int, message string) string {
	if language != languageEnglish {
		return message
	}
	if translated := englishErrorMessages[message]; translated != "" {
		return translated
	}
	switch errorCodeForStatus(status) {
	case "bad_request":
		return "The request is invalid. Check your input and try again."
	case "unauthorized":
		return "Authentication is required. Please sign in again."
	case "forbidden":
		return "You do not have permission to perform this action."
	case "not_found":
		return "The requested resource was not found."
	case "method_not_allowed":
		return "The request method is not supported."
	case "conflict":
		return "The request conflicts with the current resource state."
	case "payload_too_large":
		return "The uploaded content is too large."
	case "unsupported_media_type":
		return "The content type is not supported."
	case "rate_limited":
		return "Too many requests. Please try again later."
	case "internal_error":
		return "The server could not complete the request. Please try again later."
	default:
		return "The request could not be completed."
	}
}
