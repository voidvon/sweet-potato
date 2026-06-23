class WorkerError(Exception):
    status_code = 500


class ValidationError(WorkerError):
    status_code = 400


class VideoUnavailableError(WorkerError):
    status_code = 422
