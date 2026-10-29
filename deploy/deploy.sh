#!/bin/sh
# Ship the working tree to dev3 and restart. Run from the repo root.
set -eu
BOX=${BOX:-root@2.56.246.141}
rsync -a --delete --exclude .git --exclude .claude ./ "$BOX:/opt/my.ip/"
ssh "$BOX" 'set -e
  chmod -R a+rX /opt/my.ip
  [ -f /etc/my-ip.env ] || { umask 077; echo "MYIP_KEY=$(openssl rand -hex 32)" > /etc/my-ip.env; }
  install -m 644 /opt/my.ip/deploy/my-ip.service /etc/systemd/system/my-ip.service
  install -m 644 /opt/my.ip/deploy/nginx.conf /etc/nginx/sites-available/my.ip
  ln -sf ../sites-available/my.ip /etc/nginx/sites-enabled/my.ip
  mkdir -p /var/www/acme
  systemctl daemon-reload && systemctl enable --now my-ip && systemctl restart my-ip
  nginx -t && systemctl reload nginx'
