# Bundles the official Linux AppImage (Fedora build) for headless CLI slicing.
# Fedora base matches AppImage-linked sonames (Ubuntu misses libwebkit2gtk-4.0, etc.).
# See: https://github.com/bambulab/BambuStudio/wiki/Command-Line-Usage
# Build: docker build -t bambu-studio-mcp:latest .

FROM fedora:41

RUN dnf -y install \
    wget \
    xorg-x11-server-Xvfb \
    xauth \
    mesa-libOSMesa \
    mesa-dri-drivers \
    webkit2gtk4.0 \
    libsoup \
    libwayland-server \
    gtk3 \
    libglvnd-opengl \
    && dnf clean all

ENV SSL_CERT_FILE=/etc/pki/tls/certs/ca-bundle.crt \
    LC_ALL=C.UTF-8

WORKDIR /opt/bambu

ARG BAMBU_APPIMAGE_URL=https://github.com/bambulab/BambuStudio/releases/download/v02.05.00.67/Bambu_Studio_linux_fedora-v02.05.00.66.AppImage

RUN wget -qO /opt/bambu/bambu.AppImage "${BAMBU_APPIMAGE_URL}" \
    && chmod +x /opt/bambu/bambu.AppImage \
    && cd /opt/bambu && ./bambu.AppImage --appimage-extract \
    && rm -f /opt/bambu/bambu.AppImage \
    && test -x /opt/bambu/squashfs-root/AppRun

COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
