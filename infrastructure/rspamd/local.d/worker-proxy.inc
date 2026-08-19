# Milter proxy configuration
bind_socket = "*:11334";
milter = true;
timeout = 120s;
upstream "local" {
  default = yes;
  self_scan = yes;
}
