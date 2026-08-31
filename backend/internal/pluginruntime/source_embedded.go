//go:build embedded_plugin_source

package pluginruntime

import _ "embed"

//go:embed remotion-plugin-source.tar.gz
var embeddedRemotionPluginSource []byte
