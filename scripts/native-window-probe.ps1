param([Parameter(Mandatory=$true)][int]$AppProcessId, [Parameter(Mandatory=$true)][string]$Title, [switch]$Drag)
$ErrorActionPreference = 'Stop'
if ($PSVersionTable.PSEdition -eq 'Desktop') {
  $env:PSModulePath = @(
    [IO.Path]::Combine([Environment]::GetFolderPath('MyDocuments'), 'WindowsPowerShell', 'Modules'),
    [IO.Path]::Combine($env:ProgramFiles, 'WindowsPowerShell', 'Modules'),
    [IO.Path]::Combine($PSHOME, 'Modules')
  ) -join ';'
}
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public class RandDeckWindowProbe {
  public delegate bool EnumProc(IntPtr h, IntPtr p);
  [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left,Top,Right,Bottom; }
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc p, IntPtr l);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder t, int n);
  [DllImport("user32.dll", EntryPoint="GetWindowLongPtrW")] public static extern IntPtr GetWindowLongPtr(IntPtr h,int n);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h,out Rect r);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x,int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags,uint x,uint y,uint data,UIntPtr extra);
  [DllImport("user32.dll")] public static extern int GetSystemMetrics(int index);
  public static IntPtr[] Find(int process,string title) {
    var result=new List<IntPtr>();
    EnumWindows((h,l)=>{uint id;GetWindowThreadProcessId(h,out id);var t=new StringBuilder(512);GetWindowText(h,t,512);if(id==process&&t.ToString()==title)result.Add(h);return true;},IntPtr.Zero);
    return result.ToArray();
  }
}
'@
$handles = [RandDeckWindowProbe]::Find($AppProcessId, $Title)
if ($handles.Count -ne 1) { throw "Expected exactly one owned native window; found $($handles.Count)." }
$handle = $handles[0]
$rect = New-Object RandDeckWindowProbe+Rect
[RandDeckWindowProbe]::GetWindowRect($handle, [ref]$rect) | Out-Null
$style = [RandDeckWindowProbe]::GetWindowLongPtr($handle, -20).ToInt64()
$result = [ordered]@{ handle=$handle.ToInt64(); title=$Title; alwaysOnTop=($style -band 8) -ne 0; clickThrough=($style -band 32) -ne 0; x=$rect.Left; y=$rect.Top; width=$rect.Right-$rect.Left; height=$rect.Bottom-$rect.Top; monitorCount=[RandDeckWindowProbe]::GetSystemMetrics(80) }
if ($Drag) {
  if ($result.clickThrough) { throw 'Turn off click-through before the native drag check.' }
  [RandDeckWindowProbe]::SetForegroundWindow($handle) | Out-Null
  $x = $rect.Left + 90
  $y = $rect.Top + 43
  [RandDeckWindowProbe]::SetCursorPos($x, $y) | Out-Null
  [RandDeckWindowProbe]::mouse_event(2,0,0,0,[UIntPtr]::Zero)
  try {
    Start-Sleep -Milliseconds 350
    foreach ($step in 1..12) {
      [RandDeckWindowProbe]::SetCursorPos(($x + $step * 8), ($y + $step * 3)) | Out-Null
      Start-Sleep -Milliseconds 25
    }
  } finally { [RandDeckWindowProbe]::mouse_event(4,0,0,0,[UIntPtr]::Zero) }
  Start-Sleep -Milliseconds 200
  $after = New-Object RandDeckWindowProbe+Rect
  [RandDeckWindowProbe]::GetWindowRect($handle,[ref]$after) | Out-Null
  $result.dragMoved = [math]::Abs($after.Left-$rect.Left) -ge 20 -or [math]::Abs($after.Top-$rect.Top) -ge 20
  $result.afterX=$after.Left; $result.afterY=$after.Top
}
$result | ConvertTo-Json -Compress
