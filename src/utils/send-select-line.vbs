Set WshShell = WScript.CreateObject("WScript.Shell")
WScript.Sleep 100
WshShell.SendKeys "{HOME}"
WScript.Sleep 100
WshShell.SendKeys "+{END}"
WScript.Sleep 100
WshShell.SendKeys "^c"
