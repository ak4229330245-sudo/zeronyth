export PATH=/workspace/podman/podman-linux-amd64/usr/local/bin:$PATH CONTAINERS_CONF=/workspace/podman/etc/containers.conf CONTAINERS_STORAGE_CONF=/workspace/podman/etc/storage.conf CONTAINERS_REGISTRIES_CONF=/workspace/podman/etc/registries.conf XDG_RUNTIME_DIR=/workspace/podman/run TMPDIR=/workspace/podman/tmp
alias podman="podman --signature-policy=/workspace/podman/etc/policy.json"
