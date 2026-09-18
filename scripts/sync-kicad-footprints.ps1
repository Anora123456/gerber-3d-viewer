param(
  [string]$KiCadModels = 'D:\Program Files\KiCad\10.0\share\kicad\3dmodels',
  [string]$Destination = (Join-Path $PSScriptRoot '..\footprint')
)

$ErrorActionPreference = 'Stop'
$Destination = [System.IO.Path]::GetFullPath($Destination)

if (-not (Test-Path -LiteralPath $KiCadModels -PathType Container)) {
  throw "KiCad model directory not found: $KiCadModels"
}

if (-not (Test-Path -LiteralPath $Destination -PathType Container)) {
  New-Item -ItemType Directory -Path $Destination -Force | Out-Null
}

$mappings = @(
  [pscustomobject]@{ Alias='C 0402_L'; Category='passive\capacitor'; Target='C_0402_L.step'; Source='Capacitor_SMD.3dshapes\C_0402_1005Metric.step'; Confidence='exact'; Note='0402 imperial / 1005 metric' },
  [pscustomobject]@{ Alias='C 0603_L'; Category='passive\capacitor'; Target='C_0603_L.step'; Source='Capacitor_SMD.3dshapes\C_0603_1608Metric.step'; Confidence='exact'; Note='0603 imperial / 1608 metric' },
  [pscustomobject]@{ Alias='C 0805_L'; Category='passive\capacitor'; Target='C_0805_L.step'; Source='Capacitor_SMD.3dshapes\C_0805_2012Metric.step'; Confidence='exact'; Note='0805 imperial / 2012 metric' },
  [pscustomobject]@{ Alias='C 1206_L'; Category='passive\capacitor'; Target='C_1206_L.step'; Source='Capacitor_SMD.3dshapes\C_1206_3216Metric.step'; Confidence='exact'; Note='1206 imperial / 3216 metric' },
  [pscustomobject]@{ Alias='CM D(6.3*5.4)'; Category='passive\capacitor'; Target='CM_D_6.3_5.4.step'; Source='Capacitor_SMD.3dshapes\C_Elec_6.3x5.4.step'; Confidence='exact'; Note='6.3 x 5.4 mm aluminum electrolytic' },
  [pscustomobject]@{ Alias='R 0402_L'; Category='passive\resistor'; Target='R_0402_L.step'; Source='@destination\User Library-R-1005-0402.STEP'; Confidence='user'; Note='User supplied 0402 resistor model' },
  [pscustomobject]@{ Alias='R 0805_L'; Category='passive\resistor'; Target='R_0805_L.step'; Source='Resistor_SMD.3dshapes\R_0805_2012Metric.step'; Confidence='exact'; Note='0805 imperial / 2012 metric' },
  [pscustomobject]@{ Alias='R 1206_L'; Category='passive\resistor'; Target='R_1206_L.step'; Source='Resistor_SMD.3dshapes\R_1206_3216Metric.step'; Confidence='exact'; Note='1206 imperial / 3216 metric' },
  [pscustomobject]@{ Alias='R 2512_L'; Category='passive\resistor'; Target='R_2512_L.step'; Source='Resistor_SMD.3dshapes\R_2512_6332Metric.step'; Confidence='exact'; Note='2512 imperial / 6332 metric' },
  [pscustomobject]@{ Alias='FU 1206'; Category='passive\fuse'; Target='FU_1206.step'; Source='Fuse.3dshapes\Fuse_1206_3216Metric.step'; Confidence='exact'; Note='1206 fuse' },
  [pscustomobject]@{ Alias='LED 0402G'; Category='opto\led'; Target='LED_0402G.step'; Source='LED_SMD.3dshapes\LED_0402_1005Metric.step'; Confidence='compatible'; Note='Generic 0402 LED geometry' },
  [pscustomobject]@{ Alias='LED 0402R'; Category='opto\led'; Target='LED_0402R.step'; Source='LED_SMD.3dshapes\LED_0402_1005Metric.step'; Confidence='compatible'; Note='Generic 0402 LED geometry' },

  [pscustomobject]@{ Alias='DFN-8-3*3-EP'; Category='semiconductor\ic'; Target='DFN-8-3_3-EP.step'; Source='Package_DFN_QFN.3dshapes\DFN-8-1EP_3x3mm_P0.65mm_EP1.5x2.25mm.step'; Confidence='compatible'; Note='3 x 3 mm DFN-8 with exposed pad' },
  [pscustomobject]@{ Alias='LQFP64_N'; Category='semiconductor\ic'; Target='LQFP64_N.step'; Source='Package_QFP.3dshapes\LQFP-64_10x10mm_P0.5mm.step'; Confidence='exact'; Note='STM32F103RE package' },
  [pscustomobject]@{ Alias='QFN20_3x3_EP'; Category='semiconductor\ic'; Target='QFN20_3x3_EP.step'; Source='Package_DFN_QFN.3dshapes\UQFN-20-1EP_3x3mm_P0.4mm_EP1.85x1.85mm.step'; Confidence='compatible'; Note='3 x 3 mm QFN-20 with exposed pad' },
  [pscustomobject]@{ Alias='QFN24 4x4_N'; Category='semiconductor\ic'; Target='QFN24_4x4_N.step'; Source='Package_DFN_QFN.3dshapes\QFN-24-1EP_4x4mm_P0.5mm_EP2.7x2.7mm.step'; Confidence='compatible'; Note='4 x 4 mm QFN-24 with exposed pad' },
  [pscustomobject]@{ Alias='QFN32 4X4'; Category='semiconductor\ic'; Target='QFN32_4X4.step'; Source='Package_DFN_QFN.3dshapes\QFN-32-1EP_4x4mm_P0.4mm_EP2.9x2.9mm.step'; Confidence='compatible'; Note='4 x 4 mm QFN-32 with exposed pad' },
  [pscustomobject]@{ Alias='SC70-6'; Category='semiconductor\ic'; Target='SC70-6.step'; Source='Package_TO_SOT_SMD.3dshapes\SOT-363_SC-70-6.step'; Confidence='exact'; Note='SC-70-6 / SOT-363' },
  [pscustomobject]@{ Alias='SO-08'; Category='semiconductor\ic'; Target='SO-08.step'; Source='Package_SO.3dshapes\SO-8_3.9x4.9mm_P1.27mm.step'; Confidence='exact'; Note='Standard SO-8' },
  [pscustomobject]@{ Alias='SOT23-5L'; Category='semiconductor\ic'; Target='SOT23-5L.step'; Source='Package_TO_SOT_SMD.3dshapes\SOT-23-5.step'; Confidence='exact'; Note='SOT-23-5' },
  [pscustomobject]@{ Alias='SOT23-6'; Category='semiconductor\ic'; Target='SOT23-6.step'; Source='Package_TO_SOT_SMD.3dshapes\SOT-23-6.step'; Confidence='exact'; Note='SOT-23-6' },
  [pscustomobject]@{ Alias='SOD-123F'; Category='semiconductor\diode'; Target='SOD-123F.step'; Source='Diode_SMD.3dshapes\D_SOD-123F.step'; Confidence='exact'; Note='Flat lead SOD-123F' },
  [pscustomobject]@{ Alias='SOD-923'; Category='semiconductor\diode'; Target='SOD-923.step'; Source='Diode_SMD.3dshapes\D_SOD-923.step'; Confidence='exact'; Note='SOD-923' },
  [pscustomobject]@{ Alias='SOT23-3L'; Category='semiconductor\transistor'; Target='SOT23-3L.step'; Source='Package_TO_SOT_SMD.3dshapes\SOT-23-3.step'; Confidence='exact'; Note='SOT-23-3 lead variant L' },
  [pscustomobject]@{ Alias='SOT23-3N'; Category='semiconductor\transistor'; Target='SOT23-3N.step'; Source='Package_TO_SOT_SMD.3dshapes\SOT-23-3.step'; Confidence='exact'; Note='SOT-23-3 lead variant N' },
  [pscustomobject]@{ Alias='SOT-723'; Category='semiconductor\transistor'; Target='SOT-723.step'; Source=''; Confidence='manual-needed'; Note='No reliable KiCad 10 model found' },

  [pscustomobject]@{ Alias='FXL0530-L'; Category='electromechanical\inductor'; Target='FXL0530-L.step'; Source='Inductor_SMD.3dshapes\L_Changjiang_FXL0530.step'; Confidence='exact'; Note='Changjiang FXL0530' },
  [pscustomobject]@{ Alias='HC0420'; Category='electromechanical\inductor'; Target='HC0420.step'; Source='Inductor_SMD.3dshapes\L_APV_APH0420.step'; Confidence='compatible'; Note='4 x 4 x 2 mm molded inductor' },
  [pscustomobject]@{ Alias='SMD 13x13'; Category='electromechanical\inductor'; Target='SMD_13x13.step'; Source='Inductor_SMD.3dshapes\L_APV_APH1265.step'; Confidence='compatible'; Note='12.6 x 12.6 x 6.5 mm molded inductor' },
  [pscustomobject]@{ Alias='OSC 3225-4P'; Category='electromechanical\crystal'; Target='OSC_3225-4P.step'; Source='Crystal.3dshapes\Crystal_SMD_3225-4Pin_3.2x2.5mm.step'; Confidence='exact'; Note='3225 four-pad crystal' },
  [pscustomobject]@{ Alias='MLT-8530'; Category='electromechanical\buzzer'; Target='MLT-8530.step'; Source='Buzzer_Beeper.3dshapes\Buzzer_Murata_PKMCS0909E.step'; Confidence='compatible'; Note='Closest 9 x 9 mm SMD buzzer' },
  [pscustomobject]@{ Alias='TSW SMD-6*6*4.3'; Category='electromechanical\switch'; Target='TSW_SMD-6_6_4.3.step'; Source='Button_Switch_SMD.3dshapes\SW_Push_1TS009xxxx-xxxx-xxxx_6x6x5mm.step'; Confidence='compatible'; Note='Closest 6 x 6 mm SMD push switch' },

  [pscustomobject]@{ Alias='BT2.0-M'; Category='connector'; Target='BT2.0-M.step'; Source='Connector_JST.3dshapes\JST_PH_B2B-PH-K_1x02_P2.00mm_Vertical.step'; Confidence='compatible'; Note='2-pin 2.0 mm vertical battery connector' },
  [pscustomobject]@{ Alias='FPC0.5 2H-WS-12P'; Category='connector'; Target='FPC0.5_2H-WS-12P.step'; Source='Connector_FFC-FPC.3dshapes\Hirose_FH12-12S-0.5SH_1x12-1MP_P0.50mm_Horizontal.step'; Confidence='compatible'; Note='12-pin 0.5 mm horizontal FPC connector' },
  [pscustomobject]@{ Alias='GCT-USB4105-XX-A_V'; Category='connector'; Target='GCT-USB4105-XX-A_V.step'; Source='Connector_USB.3dshapes\USB_C_Receptacle_GCT_USB4105-xx-A_16P_TopMnt_Horizontal.step'; Confidence='exact'; Note='GCT USB4105 Type-C receptacle' },
  [pscustomobject]@{ Alias='HDR1.27-LI-4P'; Category='connector'; Target='HDR1.27-LI-4P.step'; Source='Connector_PinHeader_1.27mm.3dshapes\PinHeader_1x04_P1.27mm_Vertical.step'; Confidence='compatible'; Note='Generic 1 x 4, 1.27 mm vertical header' },
  [pscustomobject]@{ Alias='JST-SM02B-SRSS-TB_V'; Category='connector'; Target='JST-SM02B-SRSS-TB_V.step'; Source='Connector_JST.3dshapes\JST_SH_SM02B-SRSS-TB_1x02-1MP_P1.00mm_Horizontal.step'; Confidence='exact'; Note='JST SH SM02B-SRSS-TB' },
  [pscustomobject]@{ Alias='PH2.0-LI-2P + 1.6mm'; Category='connector'; Target='PH2.0-LI-2P_1.6mm.step'; Source='Connector_JST.3dshapes\JST_PH_B2B-PH-K_1x02_P2.00mm_Vertical.step'; Confidence='compatible'; Note='2-pin 2.0 mm vertical header' },
  [pscustomobject]@{ Alias='M2_4.0x6.0_2.5x1.2'; Category='mechanical'; Target='M2_4.0x6.0_2.5x1.2.step'; Source='Mounting_Wuerth.3dshapes\Mounting_Wuerth_WA-SMSI-M2_H6mm_9774060243.step'; Confidence='compatible'; Note='Closest M2 x 6 mm SMD spacer' }
)

$results = foreach ($mapping in $mappings) {
  $sourcePath = if ($mapping.Source.StartsWith('@destination\')) {
    Join-Path $Destination $mapping.Source.Substring('@destination\'.Length)
  } elseif ([string]::IsNullOrWhiteSpace($mapping.Source)) {
    $null
  } else {
    Join-Path $KiCadModels $mapping.Source
  }

  $targetDirectory = Join-Path $Destination $mapping.Category
  $targetPath = Join-Path $targetDirectory $mapping.Target
  $status = 'missing'

  if ($sourcePath -and (Test-Path -LiteralPath $sourcePath -PathType Leaf)) {
    New-Item -ItemType Directory -Path $targetDirectory -Force | Out-Null
    Copy-Item -LiteralPath $sourcePath -Destination $targetPath -Force
    $status = 'copied'
  } elseif ($mapping.Confidence -eq 'manual-needed') {
    $status = 'manual-needed'
  }

  [ordered]@{
    alias = $mapping.Alias
    category = $mapping.Category.Replace('\', '/')
    file = if ($status -eq 'copied') { "$($mapping.Category.Replace('\', '/'))/$($mapping.Target)" } else { $null }
    source = $mapping.Source
    confidence = $mapping.Confidence
    status = $status
    note = $mapping.Note
  }
}

$manifest = [ordered]@{
  schemaVersion = 1
  generatedAt = (Get-Date).ToString('o')
  sourceRoot = $KiCadModels
  copiedCount = @($results | Where-Object status -eq 'copied').Count
  unresolvedCount = @($results | Where-Object status -ne 'copied').Count
  entries = @($results)
}

$manifestPath = Join-Path $Destination 'library-manifest.json'
$manifest | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $manifestPath -Encoding utf8

[pscustomobject]@{
  Destination = $Destination
  Copied = $manifest.copiedCount
  Unresolved = $manifest.unresolvedCount
  Manifest = $manifestPath
}
