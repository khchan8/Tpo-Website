@echo off
REM Batch script to consolidate store images for TPO Wellness website

REM Define target directory
SET TARGET_DIR="assets\img\stores"

echo Creating target directory: %TARGET_DIR%
IF NOT EXIST %TARGET_DIR% (
    MKDIR %TARGET_DIR%
) ELSE (
    echo Target directory %TARGET_DIR% already exists.
)
echo.

REM --- Greenhead Clinic ---
SET SOURCE_GREENHEAD_FILES="shops\Greenhead Clinic_files"
echo Processing Greenhead Clinic images from %SOURCE_GREENHEAD_FILES%...
IF EXIST %SOURCE_GREENHEAD_FILES% (
    REM Specific mappings based on plan (adjust source filenames if needed from your actual files)
    IF EXIST %SOURCE_GREENHEAD_FILES%\ourclinic-01.jpg (
        COPY %SOURCE_GREENHEAD_FILES%\ourclinic-01.jpg %TARGET_DIR%\Greenhead_Kamala_ourclinic-01.jpg /Y >NUL
        COPY %SOURCE_GREENHEAD_FILES%\ourclinic-01.jpg %TARGET_DIR%\Greenhead_Nimman_ourclinic-01.jpg /Y >NUL
        echo  - Copied ourclinic-01.jpg for Kamala and Nimman.
    ) ELSE ( echo  WARNING: %SOURCE_GREENHEAD_FILES%\ourclinic-01.jpg not found for Kamala/Nimman. )
    IF EXIST %SOURCE_GREENHEAD_FILES%\ourclinic-phuket-kata.jpg ( COPY %SOURCE_GREENHEAD_FILES%\ourclinic-phuket-kata.jpg %TARGET_DIR%\Greenhead_Kata_ourclinic-phuket-kata.jpg /Y >NUL && echo  - Copied ourclinic-phuket-kata.jpg for Kata. ) ELSE ( echo  WARNING: %SOURCE_GREENHEAD_FILES%\ourclinic-phuket-kata.jpg not found. )
    IF EXIST %SOURCE_GREENHEAD_FILES%\ourclinic-surat-chaweng.jpg ( COPY %SOURCE_GREENHEAD_FILES%\ourclinic-surat-chaweng.jpg %TARGET_DIR%\Greenhead_ChawengSamui_ourclinic-surat-chaweng.jpg /Y >NUL && echo  - Copied ourclinic-surat-chaweng.jpg for Chaweng Samui. ) ELSE ( echo  WARNING: %SOURCE_GREENHEAD_FILES%\ourclinic-surat-chaweng.jpg not found. )
    IF EXIST %SOURCE_GREENHEAD_FILES%\ourclinic-krabi-aonang.jpg ( COPY %SOURCE_GREENHEAD_FILES%\ourclinic-krabi-aonang.jpg %TARGET_DIR%\Greenhead_Aonang_ourclinic-krabi-aonang.jpg /Y >NUL && echo  - Copied ourclinic-krabi-aonang.jpg for Aonang. ) ELSE ( echo  WARNING: %SOURCE_GREENHEAD_FILES%\ourclinic-krabi-aonang.jpg not found. )
    IF EXIST %SOURCE_GREENHEAD_FILES%\ourclinic-bangkok-kaosang.jpg ( COPY %SOURCE_GREENHEAD_FILES%\ourclinic-bangkok-kaosang.jpg %TARGET_DIR%\Greenhead_Khaosan_ourclinic-bangkok-kaosang.jpg /Y >NUL && echo  - Copied ourclinic-bangkok-kaosang.jpg for Khaosan. ) ELSE ( echo  WARNING: %SOURCE_GREENHEAD_FILES%\ourclinic-bangkok-kaosang.jpg not found. )
    IF EXIST %SOURCE_GREENHEAD_FILES%\ourclinic-bangkok-Silom.jpg ( COPY %SOURCE_GREENHEAD_FILES%\ourclinic-bangkok-Silom.jpg %TARGET_DIR%\Greenhead_Silom_ourclinic-bangkok-Silom.jpg /Y >NUL && echo  - Copied ourclinic-bangkok-Silom.jpg for Silom. ) ELSE ( echo  WARNING: %SOURCE_GREENHEAD_FILES%\ourclinic-bangkok-Silom.jpg not found. )
    IF EXIST %SOURCE_GREENHEAD_FILES%\ourclinic-bangkokchina-town.jpg ( COPY %SOURCE_GREENHEAD_FILES%\ourclinic-bangkokchina-town.jpg %TARGET_DIR%\Greenhead_ChinaTownBranch_ourclinic-bangkokchina-town.jpg /Y >NUL && echo  - Copied ourclinic-bangkokchina-town.jpg for ChinaTownBranch. ) ELSE ( echo  WARNING: %SOURCE_GREENHEAD_FILES%\ourclinic-bangkokchina-town.jpg not found. )
    IF EXIST %SOURCE_GREENHEAD_FILES%\ourclinic-pattaya-PattayaSai2.jpg ( COPY %SOURCE_GREENHEAD_FILES%\ourclinic-pattaya-PattayaSai2.jpg %TARGET_DIR%\Greenhead_PattayaSai2_ourclinic-pattaya-PattayaSai2.jpg /Y >NUL && echo  - Copied ourclinic-pattaya-PattayaSai2.jpg for Pattaya Sai 2. ) ELSE ( echo  WARNING: %SOURCE_GREENHEAD_FILES%\ourclinic-pattaya-PattayaSai2.jpg not found. )
    IF EXIST %SOURCE_GREENHEAD_FILES%\ourclinic-pattaya-South-Pattaya.jpg ( COPY %SOURCE_GREENHEAD_FILES%\ourclinic-pattaya-South-Pattaya.jpg %TARGET_DIR%\Greenhead_Jomtien_ourclinic-pattaya-South-Pattaya.jpg /Y >NUL && echo  - Copied ourclinic-pattaya-South-Pattaya.jpg for Jomtien. ) ELSE ( echo  WARNING: %SOURCE_GREENHEAD_FILES%\ourclinic-pattaya-South-Pattaya.jpg not found. )

    REM Placeholder/generic for Main, PhuketTown, Andaman - User might need to adjust source file
    IF EXIST %SOURCE_GREENHEAD_FILES%\logo_new.png ( COPY %SOURCE_GREENHEAD_FILES%\logo_new.png %TARGET_DIR%\Greenhead_Main_Logo.png /Y >NUL && echo  - Copied logo_new.png as Greenhead_Main_Logo.png. ) ELSE ( echo  NOTE: %SOURCE_GREENHEAD_FILES%\logo_new.png not found for Greenhead Main. Please provide Greenhead_Main_home-01.jpg manually or update script. )
    echo  NOTE: Manually verify/source Greenhead_PhuketTown_ourclinic-02.jpg and Greenhead_Andaman_ourclinic-andaman.jpg if specific files exist in %SOURCE_GREENHEAD_FILES% and map them.
) ELSE ( echo WARNING: Source directory %SOURCE_GREENHEAD_FILES% not found. )
echo.

REM --- Stoned & Co. ---
SET SOURCE_STONED_FILES="shops\Stoned & Co Co. Ltd_files"
echo Processing Stoned & Co. images from %SOURCE_STONED_FILES%...
IF EXIST %SOURCE_STONED_FILES% (
    IF EXIST %SOURCE_STONED_FILES%\"Stoned & Co Co. Ltd.jpg" (
        COPY %SOURCE_STONED_FILES%\"Stoned & Co Co. Ltd.jpg" %TARGET_DIR%\StonedAndCo_ThongLo.jpg /Y >NUL && echo  - Copied "Stoned & Co Co. Ltd.jpg" as StonedAndCo_ThongLo.jpg.
    ) ELSE ( echo  WARNING: %SOURCE_STONED_FILES%\"Stoned & Co Co. Ltd.jpg" not found. )
) ELSE ( echo WARNING: Source directory %SOURCE_STONED_FILES% not found. )
echo.

REM --- Cannabis Twins Bangkok ---
SET SOURCE_CANNABISTWINS_FILES="shops\Cannabis Twins Bangkok_files"
echo Processing Cannabis Twins Bangkok images from %SOURCE_CANNABISTWINS_FILES%...
SET CT_Copied=0
IF EXIST %SOURCE_CANNABISTWINS_FILES% (
    IF EXIST %SOURCE_CANNABISTWINS_FILES%\image-asset.jpeg (
        COPY %SOURCE_CANNABISTWINS_FILES%\image-asset.jpeg %TARGET_DIR%\CannabisTwins_image.jpg /Y >NUL && echo  - Copied image-asset.jpeg as CannabisTwins_image.jpg. && SET CT_Copied=1
    )
    IF %CT_Copied% EQU 0 (
        FOR %%F IN (%SOURCE_CANNABISTWINS_FILES%\*.jpg) DO (
            IF %CT_Copied% EQU 0 (
                COPY "%%F" %TARGET_DIR%\CannabisTwins_image.jpg /Y >NUL && echo  - Copied %%F as CannabisTwins_image.jpg. && SET CT_Copied=1
            )
        )
    )
    IF %CT_Copied% EQU 0 (
        FOR %%F IN (%SOURCE_CANNABISTWINS_FILES%\*.png) DO (
            IF %CT_Copied% EQU 0 (
                COPY "%%F" %TARGET_DIR%\CannabisTwins_image.png /Y >NUL && echo  - Copied %%F as CannabisTwins_image.png. && SET CT_Copied=1
            )
        )
    )
    IF %CT_Copied% EQU 0 (
            echo  WARNING: No suitable .jpeg, .jpg or .png found in %SOURCE_CANNABISTWINS_FILES% for CannabisTwins_image.
    )
) ELSE ( echo WARNING: Source directory %SOURCE_CANNABISTWINS_FILES% not found. )
echo.

REM --- High Society Cannabis Club Thailand ---
SET SOURCE_HIGHSOCIETY_FILES="shops\High Society Cannabis Club Thailand_files"
echo Processing High Society images from %SOURCE_HIGHSOCIETY_FILES%...
SET HS_Copied=0
IF EXIST %SOURCE_HIGHSOCIETY_FILES% (
    IF EXIST %SOURCE_HIGHSOCIETY_FILES%\LOGO-3.png (
        COPY %SOURCE_HIGHSOCIETY_FILES%\LOGO-3.png %TARGET_DIR%\HighSociety_image.png /Y >NUL && echo  - Copied LOGO-3.png as HighSociety_image.png. && SET HS_Copied=1
    )
    IF %HS_Copied% EQU 0 (
        FOR %%F IN (%SOURCE_HIGHSOCIETY_FILES%\*.png) DO (
            IF %HS_Copied% EQU 0 (
                COPY "%%F" %TARGET_DIR%\HighSociety_image.png /Y >NUL && echo  - Copied %%F as HighSociety_image.png. && SET HS_Copied=1
            )
        )
    )
    IF %HS_Copied% EQU 0 (
        FOR %%F IN (%SOURCE_HIGHSOCIETY_FILES%\*.jpg) DO (
            IF %HS_Copied% EQU 0 (
                COPY "%%F" %TARGET_DIR%\HighSociety_image.jpg /Y >NUL && echo  - Copied %%F as HighSociety_image.jpg. && SET HS_Copied=1
            )
        )
    )
    IF %HS_Copied% EQU 0 (
            echo  WARNING: No suitable .png or .jpg found in %SOURCE_HIGHSOCIETY_FILES% for HighSociety_image.
    )
) ELSE ( echo WARNING: Source directory %SOURCE_HIGHSOCIETY_FILES% not found. )
echo.

REM --- Sawadee Sativa ---
SET SOURCE_SAWADEESATIVA_FILES="shops\Sawadee Sativa _ Premium Cannabis _ Weed Shop in Bangkok_files"
echo Processing Sawadee Sativa images from %SOURCE_SAWADEESATIVA_FILES%...
SET SS_Copied=0
IF EXIST %SOURCE_SAWADEESATIVA_FILES% (
    IF EXIST %SOURCE_SAWADEESATIVA_FILES%\Photoshoot.jpeg (
        COPY %SOURCE_SAWADEESATIVA_FILES%\Photoshoot.jpeg %TARGET_DIR%\SawadeeSativa_image.jpg /Y >NUL && echo  - Copied Photoshoot.jpeg as SawadeeSativa_image.jpg. && SET SS_Copied=1
    )
    IF %SS_Copied% EQU 0 (
        FOR %%F IN (%SOURCE_SAWADEESATIVA_FILES%\*.jpeg) DO (
            IF %SS_Copied% EQU 0 (
                COPY "%%F" %TARGET_DIR%\SawadeeSativa_image.jpg /Y >NUL && echo  - Copied %%F as SawadeeSativa_image.jpg. && SET SS_Copied=1
            )
        )
    )
    IF %SS_Copied% EQU 0 (
        FOR %%F IN (%SOURCE_SAWADEESATIVA_FILES%\*.jpg) DO (
            IF %SS_Copied% EQU 0 (
                COPY "%%F" %TARGET_DIR%\SawadeeSativa_image.jpg /Y >NUL && echo  - Copied %%F as SawadeeSativa_image.jpg. && SET SS_Copied=1
            )
        )
    )
    IF %SS_Copied% EQU 0 (
        FOR %%F IN (%SOURCE_SAWADEESATIVA_FILES%\*.png) DO (
            IF %SS_Copied% EQU 0 (
                COPY "%%F" %TARGET_DIR%\SawadeeSativa_image.png /Y >NUL && echo  - Copied %%F as SawadeeSativa_image.png. && SET SS_Copied=1
            )
        )
    )
    IF %SS_Copied% EQU 0 (
            echo  WARNING: No suitable .jpeg, .jpg or .png found in %SOURCE_SAWADEESATIVA_FILES% for SawadeeSativa_image.
    )
) ELSE ( echo WARNING: Source directory %SOURCE_SAWADEESATIVA_FILES% not found. )
echo.

REM --- Siam Green Chinatown ---
REM Attempting to source from "Chinatown Cannabis Dispensary, Bangkok_files" as per environment_details
SET SOURCE_SIAMGREEN_CHINATOWN_FILES="shops\Chinatown Cannabis Dispensary, Bangkok_files"
echo Processing Siam Green Chinatown image from %SOURCE_SIAMGREEN_CHINATOWN_FILES%...
SET SGC_Copied=0
IF EXIST %SOURCE_SIAMGREEN_CHINATOWN_FILES% (
    FOR %%F IN (%SOURCE_SIAMGREEN_CHINATOWN_FILES%\*.jpg) DO (
        IF %SGC_Copied% EQU 0 (
            COPY "%%F" %TARGET_DIR%\SiamGreen_Chinatown.jpg /Y >NUL && echo  - Copied %%F as SiamGreen_Chinatown.jpg. Please verify this is the correct image. && SET SGC_Copied=1
        )
    )
    IF %SGC_Copied% EQU 0 (
        FOR %%F IN (%SOURCE_SIAMGREEN_CHINATOWN_FILES%\*.png) DO (
            IF %SGC_Copied% EQU 0 (
                COPY "%%F" %TARGET_DIR%\SiamGreen_Chinatown.png /Y >NUL && echo  - Copied %%F as SiamGreen_Chinatown.png. Please verify this is the correct image. && SET SGC_Copied=1
            )
        )
    )
    IF %SGC_Copied% EQU 0 (
        echo  WARNING: No .jpg or .png found in %SOURCE_SIAMGREEN_CHINATOWN_FILES% for SiamGreen_Chinatown.
    )
) ELSE ( echo WARNING: Source directory %SOURCE_SIAMGREEN_CHINATOWN_FILES% not found for Siam Green Chinatown. )
echo.

echo --- Stores requiring MANUAL image sourcing ---
echo Please ensure the following images are manually sourced and placed in %TARGET_DIR% :
echo   (If a _files directory exists for any of these, you may find images there)
echo.
echo   Target Name: SiamGreen_Nana.jpg
echo     (Suggested source: An image representing Siam Green Cannabis Co (Nana))
echo.
echo   Target Name: SiamGreen_KohSamui.jpg
echo     (Suggested source: An image representing Siam Green Koh Samui Cannabis Dispensary)
echo.
echo   Target Name: SiamGreen_PhromPhong.jpg
echo     (Suggested source: An image representing Siam Green Phrom Phong, Sukhumvit Dispensary)
echo.
echo   Target Name: SiamGreen_SalaDaeng.jpg
echo     (Suggested source: An image representing SiamGreen Sala Daeng, Silom Dispensary)
echo.
echo   Target Name: CaliforniasFinest.jpg
echo     (Suggested source: An image representing California's Finest)
echo.
echo   Target Name: CannaStock.jpg
echo     (Suggested source: An image representing CannaStock)
echo.
echo   Target Name: SlimjimStrains.jpg
echo     (Suggested source: An image representing Slimjim Strains Cannabis & Weed Dispensary)
echo.
echo   Target Name: StrainzDispensary.jpg
echo     (Suggested source: An image representing Strainz Dispensary)
echo.
echo Image consolidation script finished. Review console output for warnings and check the %TARGET_DIR% directory.
echo You may need to manually select or rename some images if the script's automatic selection was not ideal.
pause