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
        for action in re.findall(r'^\s*(?:-\s*)?uses:\s*(\S+)', text, re.M):
            if not action.startswith('./') and not re.fullmatch(r'[^@]+@[a-f0-9]{40}', action):
                raise ValueError(f'{file}: action must use immutable 40-hex SHA: {action}')
        if re.search(r'gh\s+pr\s+merge|--auto(?:-merge)?\b|enablePullRequestAutoMerge', text):
            raise ValueError(f'{file}: automatic merge forbidden')
        jobs = text.split('\njobs:\n', 1)[1]
        blocks = re.split(r'^  ([\w-]+):\s*$', jobs, flags=re.M)
        for name, body in zip(blocks[1::2], blocks[2::2]):
            checkout = re.search(r'^\s*(?:-\s*)?uses: actions/checkout@', body, re.M)
            local = re.search(r'\b(?:tools|files)/[\w*.-]', body)
            if local and (not checkout or checkout.start() > local.start()):
                raise ValueError(f'{file} job {name}: checkout must precede repository file use')

    dependabot = pathlib.Path(directory).parent / 'dependabot.yml'
    if dependabot.exists():
        config = dependabot.read_text()
        for pattern in [r'package-ecosystem: github-actions', r'interval: weekly',
                        r'default-days: 7', r'open-pull-requests-limit: 1',
                        r'groups:\s*\n\s+github-actions:', r'patterns:\s*\n\s+- ["\']?\*']:
            if not re.search(pattern, config):
                raise ValueError(f'{dependabot}: preserve grouped weekly seven-day Actions updates')


if __name__ == '__main__':
    check(sys.argv[1] if len(sys.argv) > 1 else '.github/workflows')
    print('workflow checkout/trigger guard: ok')
