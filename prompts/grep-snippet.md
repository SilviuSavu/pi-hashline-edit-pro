Search file contents; matching lines carry HASH│ anchors usable in replace/insert without a re-read.
By default the pattern is matched literally (so `foo.bar` matches only the string `foo.bar`); pass `regex: true` to interpret it as a regex.
Defaults to skipping node_modules, .git, .tmp, coverage.
Pass `skip: ["..."]` to override the skip list or `no_skip: true` to scan everywhere (slow).
