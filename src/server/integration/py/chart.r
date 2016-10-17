args <- commandArgs(trailingOnly = TRUE)
print(args)

pngFile <- paste('chart/',args[1],'.png', sep="")
csvFile <- paste('',args[1],'.csv', sep="")

labelY <- ''
labelX <- ''
title <- 'NDVI - MODIS'
legendColors <- c("#004586", "#ff420e")

png( paste(pngFile, sep=""),height=300, width=800 )
library('ggplot2')

data <- read.csv(csvFile)
data$year <- as.Date(data$year, format = "%Y_%m_%d")

print('oi')

ggplot(data=data, aes(x=year, y=value, color=type, shape=type)) +
 geom_line() + 
 geom_point( size=2, fill="white") + 
 scale_color_manual('', values=legendColors) +
 scale_shape_manual('', values=c(20,20)) +
 scale_x_date(date_labels = "%m/%y"
 ) +
 scale_y_continuous(breaks=c(0,0.25,0.375,0.50,0.625,0.75,1), limits=c(0, 1)) +
 xlab(labelX) +
 ylab(labelY) +
 ggtitle(title) +
 theme(	axis.text=element_text(size=14),
        axis.title=element_text(size=0),
        legend.text=element_text(size=16),
        legend.position="none",
        panel.background = element_rect(fill = 'white'),
        panel.grid.major = element_line(colour = "#d0d0d0"),
        plot.title = element_text(size = 20, face = "bold", vjust = 7)
        )

dev.off()

