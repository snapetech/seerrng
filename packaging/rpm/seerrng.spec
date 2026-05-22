Name:           seerrng
Version:        0.1.0
Release:        1%{?dist}
Summary:        Standalone media request and discovery service
License:        MIT
URL:            https://github.com/snapetech/seerrng
Source0:        seerrng-v%{version}-linux-x64.tar.gz
Source1:        seerrng.service
Source2:        seerrng.env
Source3:        seerrng.sysusers
Source4:        seerrng.tmpfiles
BuildArch:      x86_64
Requires:       nodejs >= 22
%{?systemd_requires}

%{!?_unitdir:%global _unitdir /usr/lib/systemd/system}
%{!?_sysusersdir:%global _sysusersdir /usr/lib/sysusers.d}
%{!?_tmpfilesdir:%global _tmpfilesdir /usr/lib/tmpfiles.d}
%global seerrng_libdir %{_prefix}/lib/seerrng
%{!?systemd_post:%global systemd_post() %{nil}}
%{!?systemd_preun:%global systemd_preun() %{nil}}
%{!?systemd_postun_with_restart:%global systemd_postun_with_restart() %{nil}}
%{!?sysusers_create_compat:%global sysusers_create_compat() %{nil}}
%{!?tmpfiles_create:%global tmpfiles_create() %{nil}}

%description
SeerrNG is a standalone media request and discovery service. It can be
configured to talk to external Plex, Jellyfin, Emby, Sonarr, Radarr, Lidarr,
and Readarr-compatible services, but those services are managed separately.

%prep
%autosetup -n seerrng-v%{version}-linux-x64

%install
mkdir -p %{buildroot}%{seerrng_libdir} %{buildroot}%{_bindir} %{buildroot}%{_unitdir} \
  %{buildroot}%{_sysusersdir} %{buildroot}%{_tmpfilesdir} %{buildroot}%{_sysconfdir}/seerrng
cp -a . %{buildroot}%{seerrng_libdir}/
ln -s %{seerrng_libdir}/start.sh %{buildroot}%{_bindir}/seerrng
install -m0644 %{SOURCE1} %{buildroot}%{_unitdir}/seerrng.service
install -m0644 %{SOURCE2} %{buildroot}%{_sysconfdir}/seerrng/seerrng.env
install -m0644 %{SOURCE3} %{buildroot}%{_sysusersdir}/seerrng.conf
install -m0644 %{SOURCE4} %{buildroot}%{_tmpfilesdir}/seerrng.conf

%pre
%sysusers_create_compat %{SOURCE3}

%post
systemd-tmpfiles --create %{_tmpfilesdir}/seerrng.conf >/dev/null 2>&1 || :
systemctl daemon-reload >/dev/null 2>&1 || :

%preun
if [ "$1" -eq 0 ]; then
  systemctl --no-reload disable --now seerrng.service >/dev/null 2>&1 || :
fi

%postun
systemctl daemon-reload >/dev/null 2>&1 || :
if [ "$1" -ge 1 ]; then
  systemctl try-restart seerrng.service >/dev/null 2>&1 || :
fi

%files
%license LICENSE
%{_bindir}/seerrng
%{seerrng_libdir}
%{_unitdir}/seerrng.service
%{_sysusersdir}/seerrng.conf
%{_tmpfilesdir}/seerrng.conf
%config(noreplace) %{_sysconfdir}/seerrng/seerrng.env
