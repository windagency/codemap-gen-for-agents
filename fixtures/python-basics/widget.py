import requests
import sub


def run():
    sub.do_thing()
    helper()
    requests.get("https://example.com")


def helper():
    pass
