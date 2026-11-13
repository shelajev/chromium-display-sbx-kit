#!/usr/bin/env python3
"""Guard this repository's block-style Actions jobs, without YAML dependencies."""
import pathlib
import re
import sys


def check(directory):
    for file in pathlib.Path(directory).glob('*.yml'):
        text = file.read_text()
        if re.search(r'^\s*(pull_request|pull_request_target)\s*:', text, re.M) or re.search(r'^on:.*\bpull_request(?:_target)?\b', text, re.M):
            raise ValueError(f'{file}: PR triggers forbidden')
        jobs = text.split('\njobs:\n', 1)[1]
        blocks = re.split(r'^  ([\w-]+):\s*$', jobs, flags=re.M)
        for name, body in zip(blocks[1::2], blocks[2::2]):
            checkout = re.search(r'^\s+uses: actions/checkout@', body, re.M)
            local = re.search(r'\b(?:tools|files)/[\w*.-]', body)
            if local and (not checkout or checkout.start() > local.start()):
                raise ValueError(f'{file} job {name}: checkout must precede repository file use')


if __name__ == '__main__':
    check(sys.argv[1] if len(sys.argv) > 1 else '.github/workflows')
    print('workflow checkout/trigger guard: ok')
