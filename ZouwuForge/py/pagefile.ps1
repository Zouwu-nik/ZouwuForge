# Zouwu Forge - paging file setup (needs administrator rights).
# LTX models are 20-30 GB and are opened all at once; with a small or "system managed" paging file
# Windows fails with "The paging file is too small" (os error 1455) and the engine crashes.
# Sets a fixed paging file of 32-64 GB on the fastest drive (NVMe > SSD > HDD). Only ever increases.
#   -Check   : only report, exit 0 = OK, 2 = too small
# Exit codes: 0 = already OK, 10 = changed (reboot needed), 1 = error, 2 = too small (with -Check), 3 = no space on the fastest drive
param([switch]$Check)
$ErrorActionPreference = 'Stop'
$WantInit = 32768; $WantMax = 65536    # MB

function Current {
    $cs = Get-CimInstance Win32_ComputerSystem
    $set = @(Get-CimInstance Win32_PageFileSetting -ErrorAction SilentlyContinue)
    [pscustomobject]@{ Auto = [bool]$cs.AutomaticManagedPagefile; Settings = $set;
        BestMax = ($set | ForEach-Object { [int]$_.MaximumSize } | Measure-Object -Maximum).Maximum }
}
function IsOk($c) { (-not $c.Auto) -and ($c.BestMax -ge 32768) }

try {
    $c = Current
    $desc = if ($c.Auto) { 'system managed' } elseif ($c.Settings.Count) { ($c.Settings | ForEach-Object { "$($_.Name) $($_.InitialSize)-$($_.MaximumSize) MB" }) -join ', ' } else { 'none' }
    Write-Output "PAGEFILE current: $desc"
    if (IsOk $c) { Write-Output 'PAGEFILE OK'; exit 0 }
    if ($Check) { Write-Output 'PAGEFILE SMALL'; exit 2 }

    $admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    if (-not $admin) { Write-Output 'PAGEFILE ERROR: administrator rights are required'; exit 1 }

    # choose the fastest drive: NVMe > SSD > HDD. If the fastest drives have no room - report and stop.
    $need = $WantMax * 1MB + 15GB
    $vols = @(Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' | Where-Object { $_.DeviceID })
    function Speed($letter) {
        try {
            $d = Get-Partition -DriveLetter $letter.TrimEnd(':') | Get-Disk
            $p = Get-PhysicalDisk | Where-Object { $_.DeviceId -eq [string]$d.Number } | Select-Object -First 1
            if ($p.BusType -eq 'NVMe' -or $d.BusType -eq 'NVMe') { return 3 }
            if ($p.MediaType -eq 'SSD') { return 2 }
            return 1
        } catch { return 1 }
    }
    $ranked = $vols | ForEach-Object { [pscustomobject]@{ V = $_; S = (Speed $_.DeviceID); Free = [double]$_.FreeSpace } }
    $best = ($ranked | Measure-Object -Property S -Maximum).Maximum
    $kind = @{ 3 = 'NVMe SSD'; 2 = 'SSD'; 1 = 'HDD' }[[int]$best]
    $fast = $ranked | Where-Object { $_.S -eq $best } | Sort-Object Free -Descending
    $pick = $fast | Where-Object { $_.Free -ge $need } | Select-Object -First 1
    if (-not $pick) {
        $list = ($fast | ForEach-Object { '{0} {1:N0} GB free' -f $_.V.DeviceID, ($_.Free / 1GB) }) -join ', '
        Write-Output ("PAGEFILE NOSPACE: the fastest drive (${kind}: $list) needs about {0:N0} GB free. Free up space there and run again." -f ($need / 1GB))
        exit 3
    }
    $target = $pick.V
    Write-Output ("PAGEFILE drive: {0} ({1}, {2:N0} GB free)" -f $target.DeviceID, $kind, ($pick.Free / 1GB))
    $drive = $target.DeviceID
    $name = "$drive\pagefile.sys"
    Write-Output "PAGEFILE target: $name $WantInit-$WantMax MB"

    $cs = Get-CimInstance Win32_ComputerSystem
    if ($cs.AutomaticManagedPagefile) { Set-CimInstance -InputObject $cs -Property @{ AutomaticManagedPagefile = $false } }
    $s = Get-CimInstance Win32_PageFileSetting | Where-Object { $_.Name -ieq $name }
    if ($s) {
        $init = [math]::Max([int]$s.InitialSize, $WantInit); $max = [math]::Max([int]$s.MaximumSize, $WantMax)
        Set-CimInstance -InputObject $s -Property @{ InitialSize = [uint32]$init; MaximumSize = [uint32]$max }
    } else {
        New-CimInstance -ClassName Win32_PageFileSetting -Property @{ Name = $name } | Out-Null
        $s = Get-CimInstance Win32_PageFileSetting | Where-Object { $_.Name -ieq $name }
        Set-CimInstance -InputObject $s -Property @{ InitialSize = [uint32]$WantInit; MaximumSize = [uint32]$WantMax }
    }
    $chk = Get-CimInstance Win32_PageFileSetting | Where-Object { $_.Name -ieq $name }
    if ((-not $chk) -or ([int]$chk.MaximumSize -lt $WantMax)) { Write-Output 'PAGEFILE ERROR: Windows did not accept the new size'; exit 1 }
    Write-Output 'PAGEFILE CHANGED - restart the computer to apply'
    exit 10
} catch {
    Write-Output ("PAGEFILE ERROR: " + $_.Exception.Message)
    exit 1
}
