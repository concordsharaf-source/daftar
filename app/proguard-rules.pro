# قواعد R8/ProGuard لـ«دفتر»
# ملاحظة: release الحالي لا يفعّل التصغير (isMinifyEnabled = false)،
# لكن هذه القواعد تبقى جاهزة عند تفعيله.

# kotlinx.serialization (النسخ الاحتياطي/الاستعادة)
-keepattributes *Annotation*, InnerClasses
-dontnote kotlinx.serialization.**
-keepclassmembers class kotlinx.serialization.json.** { *** Companion; }
-keepclasseswithmembers class kotlinx.serialization.json.** { kotlinx.serialization.KSerializer serializer(...); }
-keep,includedescriptorclasses class com.daftar.notes.**$$serializer { *; }
-keepclassmembers class com.daftar.notes.** { *** Companion; }
-keepclasseswithmembers class com.daftar.notes.** { kotlinx.serialization.KSerializer serializer(...); }

# Room
-keep class * extends androidx.room.RoomDatabase { <init>(); }
-dontwarn androidx.room.paging.**

# Compose / lifecycle
-dontwarn androidx.compose.**

# jsoup
-dontwarn org.jsoup.**
