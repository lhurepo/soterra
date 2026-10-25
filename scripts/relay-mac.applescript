-- [B] Sends one text with Messages.app: osascript relay-mac.applescript <to E.164> <body> <SMS|iMessage>.
-- Called by scripts/relay-mac.ts with the text as argv (never interpolated into the script). "SMS" needs Text
-- Message Forwarding from an iPhone signed into the same Apple ID (docs/mac-relay.md).
on run argv
	set svc to item 3 of argv
	tell application "Messages"
		if svc is "iMessage" then
			set acct to 1st account whose service type = iMessage
		else
			set acct to 1st account whose service type = SMS
		end if
		send (item 2 of argv) to participant (item 1 of argv) of acct
	end tell
end run
