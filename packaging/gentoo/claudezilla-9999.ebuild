# Copyright 2025 Gentoo Authors
# Distributed under the terms of the MIT License

EAPI=8

DESCRIPTION="Firefox browser automation for Claude Code"
HOMEPAGE="https://github.com/@REPO@"

if [[ ${PV} == 9999 ]]; then
	inherit git-r3
	EGIT_REPO_URI="https://github.com/@REPO@.git"
else
	# The release tarball vendors mcp/node_modules, so the build stays offline.
	SRC_URI="https://github.com/@REPO@/releases/download/v${PV}/${P}-vendored.tar.gz"
	KEYWORDS="~amd64 ~arm64"
fi

LICENSE="MIT"
SLOT="0"

RDEPEND="net-libs/nodejs"
BDEPEND="app-arch/zip"

src_compile() {
	cd extension && zip -qr ../claudezilla.xpi . || die
}

src_install() {
	DESTDIR="${D}" ./packaging/common/install-tree.sh || die
}

pkg_postinst() {
	elog "Run 'claudezilla-setup' once per user to register the MCP server"
	elog "with Claude Code and sideload the extension into Firefox."
}
